# Deploying

Everything ships to AWS account `162956754427` in `us-east-1`. See
[README](README.md#production) for how the pieces fit together; this file is the
runbook and the list of things that have already gone wrong.

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
aws s3 sync dist/ s3://coyv-site-162956754427/ --delete --exclude index.html \
  --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html s3://coyv-site-162956754427/index.html \
  --cache-control "no-cache,must-revalidate"
aws cloudfront create-invalidation --distribution-id E1J2EEQCJDHQJV --paths "/*"
```

The two-step upload is deliberate. Vite fingerprints every asset, so those are
safe to cache forever, but `index.html` is the one file whose name never changes
and it must never be cached — otherwise browsers keep loading the old bundle
hashes, which `--delete` has just removed, and the site white-screens.

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
