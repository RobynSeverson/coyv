# Deploying

Everything ships to AWS account `162956754427` in `us-east-1`. See
[README](README.md#production) for how the pieces fit together; this file is the
runbook and the list of things that have already gone wrong.

The `deploy` skill in `.github/skills/deploy/` carries the same procedure in the
order it is actually performed, so Copilot sessions pick it up automatically.
Update both when the process changes.

## Before anything

```bash
export AWS_SHARED_CREDENTIALS_FILE="$(pwd)/.aws-credentials"
export AWS_PROFILE=coyv-cli AWS_DEFAULT_REGION=us-east-1
aws sts get-caller-identity        # expect account 162956754427
```

That check is worth doing. The SDK falls back to whatever ambient profile the
machine has, and on a laptop with other AWS accounts configured you can deploy —
or sign S3 URLs — as entirely the wrong identity without any error.

Both exports matter. `coyv-cli` is defined in the repo-local
`.aws-credentials`, not in `~/.aws`, so setting only `AWS_PROFILE` fails with
"The config profile (coyv-cli) could not be found". Skipping the block entirely
is worse: the commands run as the ambient identity and fail with `AccessDenied`
naming a user in a **different account** (`arn:aws:iam::813423893927:...`),
which reads like a permissions problem rather than the missing export it is.
Any AWS error mentioning an account other than `162956754427` means this block
was skipped — each shell needs it again, since exports do not persist.

## What to deploy

| Changed | Deploy |
| --- | --- |
| `src/**`, `index.html`, `vite.config.ts` | frontend only |
| `server/**` | API only |
| both | **API first**, then the frontend |

API first matters when the new SPA calls endpoints that do not exist yet:
CloudFront starts serving the new bundle the moment the invalidation lands, and
any visitor mid-session gets 404s until the Lambda catches up.

Changes to `.env.example`, `README.md` or this file ship nothing.

## Frontend

```bash
npm run build
aws s3 sync dist/ s3://coyv-site-162956754427/ --delete \
  --exclude index.html --exclude robots.txt --exclude sitemap.xml \
  --exclude email-header.jpg --exclude email-paper.jpg --exclude email-footer.jpg \
  --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html s3://coyv-site-162956754427/index.html \
  --cache-control "no-cache,must-revalidate"
aws s3 cp dist/robots.txt s3://coyv-site-162956754427/robots.txt \
  --cache-control "public,max-age=300" --content-type "text/plain; charset=utf-8"
aws s3 cp dist/sitemap.xml s3://coyv-site-162956754427/sitemap.xml \
  --cache-control "public,max-age=300" --content-type "application/xml; charset=utf-8"
for f in email-header.jpg email-paper.jpg email-footer.jpg; do
  aws s3 cp dist/$f s3://coyv-site-162956754427/$f \
    --cache-control "public,max-age=86400" --content-type "image/jpeg"
done
aws cloudfront create-invalidation --distribution-id E1J2EEQCJDHQJV --paths "/*"
```

The split upload is deliberate. Vite fingerprints every asset, so those are safe
to cache forever, but `index.html` is the one file whose name never changes and
it must never be cached — otherwise browsers keep loading the old bundle hashes,
which `--delete` has just removed, and the site white-screens. `robots.txt` and
`sitemap.xml` are in the same position: their names are fixed and Google is told
to re-read them, so a year-long cache would pin whatever was shipped first. The
explicit `--content-type` is there because `s3 cp` otherwise guesses, and a
sitemap served as `binary/octet-stream` is rejected.

The three `email-*.jpg` files are the artwork every transactional email is laid
on — a crest at the top, paper tiling behind the text, a strip at the bottom —
and they belong to the same family: the templates reference them by fixed names
at `PUBLIC_SITE_URL`, so they are never fingerprinted and a year-long cache
would leave mail clients painting the old artwork long after it changed.
`email-paper.jpg` is exported at exactly the 600px table width because it tiles
at its natural size: `background-size` is ignored by Outlook. It lives in
`public/` rather than the assets bucket because a mail client fetches it
unauthenticated, and the assets bucket only hands out signed URLs that would
have expired by the time the email was opened. Changing the artwork means a
deploy — or, to preview it without one, an `s3 cp` of just those objects
followed by an invalidation of their paths.

**Replacing the file is not enough on its own.** Gmail serves mail images
through its own proxy, which caches them by URL and honours neither the cache
headers nor a CloudFront invalidation: every email already sent — and every new
one — keeps showing the artwork the proxy fetched first. The templates carry an
`ART_VERSION` appended as `?v=N` for exactly this reason. Bump it in
`server/src/services/email/templates.ts` whenever a piece is redrawn, or spend
an evening convinced the upload silently failed.

`VITE_*` variables are inlined at build time, not read at runtime. Changing
`VITE_STRIPE_PUBLISHABLE_KEY` or `VITE_ADMIN_PATH` means a fresh `npm run build`
and re-upload; setting them on the Lambda does nothing.

### The build does not pick up the live Stripe key on its own

Production is **always** in live mode. `.env` in the repo root holds a
**`pk_test`** key for local work, and `npm run build` would happily inline it.
Production once served a `pk_test` bundle against an `sk_live` Lambda, and
because Stripe refuses to confirm a live `client_secret` with a test-mode key,
live checkout was broken with no error anywhere in AWS.

`vite.config.ts` now refuses to complete a production build unless
`VITE_STRIPE_PUBLISHABLE_KEY` starts with `pk_live_`, so this cannot ship
silently again — but that means a bare `npm run build` fails by design. Pass the
live key:

```bash
curl -s https://coyvcastle.com/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
curl -s https://coyvcastle.com/assets/index-<hash>.js \
  | grep -o 'pk_live_[A-Za-z0-9]\+' | head -1 > /tmp/pk.txt

VITE_STRIPE_PUBLISHABLE_KEY="$(cat /tmp/pk.txt)" npm run build
```

The currently deployed bundle is the source of truth for the key, so this needs
no dashboard login. The key is publishable, so it is safe to read this way, but
it is still not committed — every `.env*` is ignored. Confirm before uploading:

```bash
grep -c pk_live_ dist/assets/index-*.js   # expect 1
grep -c pk_test_ dist/assets/index-*.js   # expect 0
```

Publishable and secret keys must also be from the same Stripe account; compare
the account fragment that follows `pk_live_`/`sk_live_`. The guard cannot check
this — it only knows the key is live, not whose.

## API

```bash
REG=162956754427.dkr.ecr.us-east-1.amazonaws.com
aws ecr get-login-password | docker login --username AWS --password-stdin $REG

docker buildx build --platform linux/amd64 --provenance=false --sbom=false \
  --output type=image,name=$REG/coyv-api:lambda,oci-mediatypes=false,push=true ./server

aws lambda update-function-code --function-name coyv-api \
  --image-uri $REG/coyv-api:lambda
aws lambda wait function-updated --function-name coyv-api
curl -sf https://coyvcastle.com/api/health && echo " api ok"
```

### `--platform linux/amd64` is not optional

The Lambda is `x86_64`. A default build on an Apple Silicon Mac produces an
arm64 image that builds, pushes and deploys perfectly happily, reports
`LastUpdateStatus: Successful`, and then returns 500 on every single request
with `Extension.LaunchError` on `lambda-adapter` — the adapter binary cannot
execute. This has taken production down before.

```bash
docker image inspect $REG/coyv-api:lambda --format '{{.Os}}/{{.Architecture}}'
# must print linux/amd64
```

**`LastUpdateStatus: Successful` only means the image was accepted, not that it
runs.** Always curl `/api/health` afterwards.

### Other image gotchas

- `--provenance=false --sbom=false` are required. Without them buildx pushes a
  multi-manifest attestation index that Lambda refuses.
- `update-function-code --image-uri` rejects a combined `repo:tag@sha256:…`
  reference. Pass either `repo:tag` or `repo@sha256:…`, never both.

### Memories need a one-off migration after the archive rewrite

Memories used to hold a single `image`; they now hold an `images` array, a
`kind` (`photo` or `journal`), a markdown `body` and a `capturedAt` date. The
serializer still reads the old single-image shape, so the gallery keeps working
whether or not this has been run — but until it is, those records have no date,
show `----/--/-- --:--` in the list, and cannot be edited in the admin panel.

Run it once against production after the API is deployed. It is safe to re-run.
It was run on 2026-09-18 and reported `7 memories: 7 moved to images[], 7 dated`.

The script imports `src/env.ts`, which validates the whole server configuration,
so it will not start on the production URI alone — it also needs `JWT_SECRET`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `S3_BUCKET`. Load the local
`.env` for those and override only the connection, which works because a shell
variable wins over `--env-file`:

```bash
# from server/, with the credentials block from the deploy skill exported
CFG=$(aws lambda get-function-configuration --function-name coyv-api \
  --query 'Environment.Variables' --output json)
export MONGODB_URI=$(echo "$CFG" | python3 -c "import json,sys;print(json.load(sys.stdin)['MONGODB_URI'])")
export MONGODB_DB_NAME=$(echo "$CFG" | python3 -c "import json,sys;print(json.load(sys.stdin)['MONGODB_DB_NAME'])")
node --env-file-if-exists=.env src/scripts/migrateMemoryImages.ts
```

The Lambda's `MONGODB_URI` points at a cluster named `coyvcastle-dev`. Despite
the name, that **is** production — there is no separate production cluster.

### `backfill-subscription-payments`

Subscription earnings are read from one record per paid Stripe invoice, written
by the `invoice.paid` webhook. Invoices that were paid before that webhook hook
existed have no record, so subscriptions would show no earnings at all for
them. The script walks every local subscription's Stripe invoices and records
what is missing; it is keyed on the invoice id, so re-running it changes
nothing.

It reads **Stripe**, not just Mongo, so the local `.env`'s `sk_test` key would
find no invoices and report success having done nothing. Override the secret
key with the live one as well as the connection:

```bash
# from server/, with the credentials block from the deploy skill exported
CFG=$(aws lambda get-function-configuration --function-name coyv-api \
  --query 'Environment.Variables' --output json)
read_var() { echo "$CFG" | python3 -c "import json,sys;print(json.load(sys.stdin)['$1'])"; }
export MONGODB_URI=$(read_var MONGODB_URI)
export MONGODB_DB_NAME=$(read_var MONGODB_DB_NAME)
export STRIPE_SECRET_KEY=$(read_var STRIPE_SECRET_KEY)   # must start sk_live
npm run backfill-subscription-payments
```

Run on 2026-10-01, reporting `1 subscriptions, 1 invoices seen, 1 newly
recorded`.

### `backfill-order-numbers`

Order numbers used to be derived from the record's id (`A1B2C3D4`); they are now
drawn from counters in the `counters` collection. There are **two tracks**:

- `CV00001` — money that moved. Orders that reached `paid` or `refunded`, plus
  every recorded subscription charge, share this one sequence, because the admin
  list shows them in a single table.
- `INC00001` — baskets that never paid. A row is written at checkout so Stripe
  has something to hang the payment intent on, and most of them are abandoned;
  the webhook moves a record from INC to CV when the payment clears.

The serializer falls back to the old derived reference for any record without a
stored number, so the site works either way.

Run it once against production **after** the API is deployed, so the counters are
not left behind by writes the new code makes.

**This renumbers every record**, so it must not be run once CV numbers have been
quoted to customers who could still be holding them. It was safe on 2026-09-23
because only one record had ever settled.

```bash
# from server/, with the credentials block from the deploy skill exported
CFG=$(aws lambda get-function-configuration --function-name coyv-api \
  --query 'Environment.Variables' --output json)
read_var() { echo "$CFG" | python3 -c "import json,sys;print(json.load(sys.stdin)['$1'])"; }
export MONGODB_URI=$(read_var MONGODB_URI)
export MONGODB_DB_NAME=$(read_var MONGODB_DB_NAME)
npm run backfill-order-numbers
```

Run twice on 2026-09-23. The first pass numbered everything `CV`, which showed
the problem plainly: 23 of the 24 records were abandoned baskets, so the one
real transaction had landed on `CV00007`. The second pass, after the two tracks
existed, reported `24 records: 1 settled (CV), 23 incomplete (INC)`.

Incomplete orders are left out of `GET /api/admin/orders` entirely — the route
only queries `SETTLED_ORDER_STATUSES`, and asking it for `?status=pending` is a
validation error rather than an empty list. If the checkout ever appears to go
quiet, that list is not where a failed payment will show up; look in Stripe, or
query the `orders` collection directly for `INC` records.

## Environment variables

`update-function-configuration --environment` **replaces the entire variable
map**. Passing the one variable you want to change silently deletes every other
one, which takes the API down as soon as the next cold start fails validation.
Always read, merge, then write:

```bash
aws lambda get-function-configuration --function-name coyv-api \
  --query 'Environment.Variables' > /tmp/env.json

# edit /tmp/env.json, or merge programmatically, then:
aws lambda update-function-configuration --function-name coyv-api \
  --cli-input-json "$(jq -n --slurpfile v /tmp/env.json \
    '{FunctionName:"coyv-api", Environment:{Variables:$v[0]}}')"

aws lambda wait function-updated --function-name coyv-api
curl -sf https://coyvcastle.com/api/health && echo " api ok"
```

Long-lived secrets also live in Secrets Manager under `coyv/*`, but the Lambda
reads plain environment variables — updating the secret alone changes nothing
until the variable is updated too.

## Verifying

```bash
curl -sf https://coyvcastle.com/api/health
curl -so /dev/null -w '%{http_code}\n' https://coyvcastle.com/api/products
curl -so /dev/null -w '%{http_code}\n' https://coyvcastle.com/api/admin/fulfillments  # expect 401
```

A 401 from an admin route is a pass: it proves the route exists and auth is
wired. A 500 or 403 there is not.

For the frontend, hard-reload the site and confirm the bundle hash in the HTML
changed. CloudFront invalidations take a minute or two to finish.

## Rolling back

Images are immutable by digest, so the previous one is still in ECR:

```bash
aws ecr describe-images --repository-name coyv-api \
  --query 'reverse(sort_by(imageDetails,&imagePushedAt))[:5].[imageDigest,imagePushedAt]' \
  --output text

aws lambda update-function-code --function-name coyv-api \
  --image-uri $REG/coyv-api@sha256:<digest>
```

The frontend has no equivalent — `s3 sync --delete` destroys the old assets. To
roll back, rebuild from the previous commit and deploy again.

## Assets bucket

`coyv-assets-162956754427` is shared: local development reads and writes the
same bucket production serves. Anything uploaded through a local admin session
is really there. Local test uploads are harmless as long as no production record
points at them, but they do accumulate, and deleting objects to tidy up will
break production if a live product or memory still references the key.

## Search Console

The site is a **domain property**, `sc-domain:coyvcastle.com`, verified by a DNS
TXT record. That covers `www`, bare and both protocols at once, which a URL
prefix property would not, and it was the easy option because DNS for the domain
lives in Route 53 in the same account:

```bash
aws route53 list-hosted-zones --query "HostedZones[?Name=='coyvcastle.com.']"
# Z083055312X6V0JWHT7FQ
```

The apex `TXT` also carries Brevo's SPF and its verification code, and a
`change-resource-record-sets` **replaces the whole record set**, exactly like
Lambda's environment map. Read the existing values, add to them, then write, or
outgoing mail stops being deliverable:

```bash
aws route53 list-resource-record-sets --hosted-zone-id Z083055312X6V0JWHT7FQ \
  --query "ResourceRecordSets[?Type=='TXT']"
```

Verified on 2026-09-20. **Do not remove the `google-site-verification=` value**
— Google re-checks it, and losing it loses the property.

`robots.txt` and `sitemap.xml` are static files in `public/`, so they ship with
the frontend. The sitemap is hand maintained and lists only the four public
pages; memory deep links are left out on purpose, because they open the same
document with one memory already showing. Submitted once at
`https://coyvcastle.com/sitemap.xml` — Google re-reads it on its own after that,
so a resubmission is only needed if the file moves.

### How the result looks

The listing Google draws comes from the served `index.html`, so all of it is in
the repo:

- The `<title>` and `<meta name="description">` are the headline and snippet.
  Google truncates the snippet around 150–160 characters.
- The `application/ld+json` block (`WebSite` + `Person`) is what lets Google
  show **coyv** as the site name instead of the bare domain.
- The favicon beside the result must be a square whose size is a **multiple of
  48px**, which the 512px `favico.png` is not — hence `favicon-192.png`. It is
  generated from `favico.png` with `sharp`, from a script inside `server/`.
- `og:image` and `twitter:image` are **absolute** URLs. Google's image fetcher
  drops a root-relative one entirely.

The app is a SPA, and Google renders it before indexing, so `useDocumentMeta`
rewrites the title, description, canonical and Open Graph tags on every route —
otherwise `/vault` and `/memories` would both be indexed with the landing page's
snippet.

`og-image.jpg`, `favico.png`, `favicon-192.png` and `apple-touch-icon.png` keep
fixed names but ship with the one-year `immutable` cache, unlike `robots.txt`
and `sitemap.xml`. Replacing the artwork behind one of those names therefore
needs a CloudFront invalidation of that path before anything re-fetches it —
and Google and the social scrapers cache their own copy on top of that.

After a change to any of this, request a re-crawl from **URL inspection** in
Search Console rather than waiting: paste the URL into the "Inspect any URL"
box, then **Request indexing**. Done for `/`, `/vault` and `/memories` on
2026-09-22 — the homepage was already indexed, the other two were not, so the
per-route metadata had never been seen.

## Bing Webmaster Tools

`coyvcastle.com` is registered at <https://www.bing.com/webmasters>, added by
**importing from Google Search Console** rather than a separate verification —
Bing re-checks the Google verification instead of asking for its own, and
`https://coyvcastle.com/sitemap.xml` was submitted there too (2026-09-22).

The import grants Bing a read-only OAuth scope
(`webmasters.readonly`) on the Google account that owns the Search Console
property, `robynseverson@gmail.com`. Revoking it in the Google account would
eventually break Bing's re-verification.

Both consoles resist browser automation on their final confirmation buttons:
Google's OAuth consent and Bing's *Inspect* ignore synthetic clicks entirely,
so those two steps have to be clicked by hand.
