# gates

A React + TypeScript (Vite) site. `/` is a full-bleed landing page showing the
artwork with a floating **gates** button. Clicking it plays a splotchy dissolve:
soft blobs bloom outward from the button and eat holes in the artwork, revealing
the real homepage underneath, then the router settles on `/home`.

## Run

```bash
npm install
cp server/.env.example server/.env   # once; the defaults work for local dev
npm run dev      # MongoDB + API on :4000 + Vite on :5173
npm run build    # type-check + production build
npm run lint
```

`npm run dev` starts three things together: a throwaway MongoDB container on
27017, the API, and Vite. Ctrl-C stops all of them (the database container is
left running and reused next time). Run them separately if you prefer:

```bash
npm run dev:db    # just MongoDB
npm run dev:api   # just the API
npm run dev:web   # just Vite
```

Docker must be running for `dev:db`. To use a MongoDB you already have, set
`MONGODB_URI` in `server/.env` and run `npm run dev:api` / `npm run dev:web`.

## Structure

- `src/assets/` — landing artwork and the nav button PNGs
- `src/pages/Landing.tsx` / `Landing.css` — `/`, the artwork + dissolve transition
- `src/pages/Home.tsx` / `Home.css` — `/home`, prints & photos tiles
- `src/pages/Collection.tsx` / `Collection.css` — `/memories`
- `src/pages/Vault.tsx` / `Vault.css` — `/vault`, the shop (`/prints` redirects here)
- `src/pages/Subscribe.tsx` — `/subscribe/:slug`, on-site recurring signup
- `src/pages/Checkout.tsx`, `OrderStatus.tsx` — Stripe Payment Element and receipt
- `src/pages/admin/` — the unlinked admin panel
- `src/lib/api.ts` — typed client for the API in `server/`
- `src/components/BottomNav.tsx` / `.css` — fixed bottom navigation
- `src/components/SiteLayout.tsx` / `.css` — shell that wraps the nested routes
- `src/App.tsx` — routes

## How the dissolve works

The destination page (`.landing__reveal`) sits *on top* of the artwork and is
hidden by a CSS mask built from a stack of `radial-gradient` layers — one per
blob. Each layer starts at zero size and grows, and because CSS masks are
alpha-based and composite with `add`, the growing blobs union together until the
page is fully revealed.

- `BLOBS` in `Landing.tsx` controls each blob's position, diameter (`vmax`),
  delay and duration — delay roughly tracks distance from the centre, with
  jitter so some patches clear faster than their neighbours. The last entry is
  an oversized sweep that clears anything the others missed.
- Each blob gets a registered `@property --landing-bN` (`syntax: "<number>"`)
  plus a matching keyframe, generated into `BLOB_CSS`. Registration is what makes
  the value *tween* — unregistered custom properties animate discretely.
- `DISSOLVE_DURATION` in `Landing.tsx` and `--dissolve-duration` in
  `Landing.css` must stay in sync; they set the total length (2s).

### Why not an SVG mask?

WebKit does not support `mask-image: url(#someSvgMask)` on HTML elements, so the
original SVG-mask version silently failed on every iOS browser. Gradient masks
work everywhere. `supportsBlobMask` feature-detects `CSS.registerProperty` and
falls back to a plain crossfade (`.is-plain`) on older engines.

Note: a mask does **not** create a containing block for `position: fixed`
descendants (unlike `filter`), so `.landing__revealInner` carries a
`transform: translateZ(0)` to keep the fixed bottom nav inside the mask.

## Responsive notes

- Under `768px` the landing sets `--art-width: 200vw` so only the left half of
  the artwork fills the screen instead of squashing the whole piece.
- Under `480px` the bottom nav drops to a tighter type scale so all four labels
  fit on a phone.

## Backend

The site is now two pieces: the Vite app in `src/`, and a Node/TypeScript API
in `server/` that keeps the catalogue in MongoDB, takes payments through
Stripe, and stores print artwork in S3.

### Run it with Docker

```bash
cp .env.example .env      # fill in Stripe keys, S3 bucket, JWT_SECRET
docker compose up --build
```

Three services come up: `mongo`, `api` (Express on :4000) and `web` (nginx on
`WEB_PORT`, 8080 by default). nginx serves the built SPA and proxies `/api` to
the API, so everything is one origin — which is what lets the admin session
cookie stay `SameSite=Strict`.

Create the first admin once the stack is up:

```bash
docker compose exec api node dist/scripts/createAdmin.js --email you@example.com
```

Omit `--password` and one is generated and printed exactly once.

### Run it without Docker

```bash
# everything at once (see Run, above)
npm run dev

# replay Stripe events at the local API
stripe listen --forward-to localhost:4000/api/stripe/webhook
```

`stripe listen` prints the `whsec_…` value that `STRIPE_WEBHOOK_SECRET` needs.

### API surface

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | 503 while Mongo is unreachable |
| `GET` | `/api/products` | published products of every type |
| `GET` | `/api/products/:slug` | |
| `GET` | `/api/prints` | deprecated alias; one-off prints only |
| `GET` | `/api/memories` | published memories, in gallery order |
| `POST` | `/api/checkout/intent` | prices the cart, returns a client secret |
| `GET` | `/api/checkout/orders/lookup` | order status, authorised by the client secret |
| `POST` | `/api/checkout/subscription` | starts an incomplete subscription |
| `GET` | `/api/checkout/subscriptions/lookup` | subscription status after payment |
| `POST` | `/api/stripe/webhook` | signature-verified, raw body |
| `POST` | `/api/admin/auth/login` `/logout` `/password` | |
| `GET` | `/api/admin/auth/me` | returns `{ admin: null }` when signed out |
| `GET/POST/PATCH/DELETE` | `/api/admin/products…` | catalogue + image upload |
| `GET/POST/PATCH/DELETE` | `/api/admin/memories…` | gallery upload, captions, order |
| `GET` | `/api/admin/orders` | |
| `GET` | `/api/admin/subscriptions` | subscriber list mirrored from Stripe |
| `GET` | `/api/admin/fulfillments` | the packing queue, filtered by status |
| `PATCH` | `/api/admin/fulfillments/:id` | mark sent / back to queue, tracking |
| `POST` | `/api/tasks/daily-digest` | scheduler-only, `x-tasks-secret` header |
| `POST` | `/api/manage/request-link` | emails a one-time link; always `{ok:true}` |
| `POST` | `/api/manage/redeem` `/signout` | spends the link, opens a 30-minute session |
| `GET` | `/api/manage/subscriptions` | the caller's own subscriptions |
| `PATCH` | `/api/manage/subscriptions/:id/address` | also moves pending parcels |
| `POST` | `/api/manage/subscriptions/:id/cancel` `/resume` | at period end |

### Product types

A product is either a **print** — a one-off purchase with optional stock — or a
**monthly print subscription**, billed every month until cancelled. The type is
chosen when the product is created and cannot be changed afterwards, because it
decides how the thing is billed.

Both types live in the same collection and both appear in the vault. A
subscription has no stock and is never "sold out"; it also cannot go in the
cart, since a recurring charge and a one-off basket are different transactions.

Saving a subscription creates or updates its recurring price in Stripe over the
API, so **the catalogue is only ever managed from this admin panel, never from
the Stripe dashboard**. Stripe prices are immutable, so changing the amount
archives the old price and mints a new one; existing subscribers keep billing
on the price they signed up at.

### How payments work

1. `/vault` lists published products; adding a print puts it in a
   `localStorage` cart.
2. `/checkout` posts the cart to `POST /api/checkout/intent`. The server looks
   every price up in Mongo, checks stock, creates a `pending` Order and a
   Stripe PaymentIntent carrying the order id in its metadata. **No amount
   from the browser is ever used.**
3. The Stripe Payment Element collects card, email and shipping address and
   confirms the intent directly with Stripe — card data never reaches this
   server.
4. `payment_intent.succeeded` arrives at the webhook, which is the *only* thing
   that marks an order paid and decrements stock. `fulfilledAt` makes a
   replayed event a no-op.
5. The browser lands on `/order?payment_intent=…` and polls the lookup endpoint
   until the webhook has landed. The client secret in the URL is what
   authorises the lookup, so an order id on its own reveals nothing.

Subscriptions follow the same shape and never leave the site. `/subscribe/:slug`
collects an email **and a postal address** — a monthly print is a physical
parcel, so there is nothing to fulfil without one — and `POST
/api/checkout/subscription` finds or creates the Stripe customer, writes the
address onto it as the customer's `shipping` so receipts and dispute evidence
match, and creates the subscription with `payment_behavior:
'default_incomplete'`. The first invoice's PaymentIntent is confirmed by the
same Payment Element the cart uses, which is what activates the subscription —
there is no redirect to Stripe-hosted Checkout. The confirmation page
reconciles straight from Stripe rather than waiting on the webhook, so a slow
event never leaves a paid subscriber staring at "pending".

Amounts are integer cents everywhere; only the view layer formats them.

### Fulfillment

Orders and subscription renewals are different transactions but the same
studio job: put a print in an envelope and post it. Both therefore feed one
`fulfillments` collection and one **fulfillment** tab, which is the queue of
parcels owed.

A row is created when money actually lands — `payment_intent.succeeded` for an
order, `invoice.paid` for each month of a subscription — so a subscriber
reappears in the queue every time they are charged, which is the point. Each
row carries the address as captured at purchase, so later edits to a customer
never rewrite what was already posted.

Idempotency is one mechanism: a unique `sourceKey` (`order:<id>` or
`invoice:<id>`) written with `$setOnInsert` on an upsert. That single
constraint covers replayed webhooks, the webhook racing the reconciliation
path in `refreshSubscription`, and a re-delivered invoice — and because it is
insert-only, a late event can never flip a parcel already marked sent back to
pending.

"Print packing slips" prints the queue through a `@media print` stylesheet that
drops the site chrome and gives each slip its own page.

### Email

Transactional mail goes through [Brevo](https://www.brevo.com). Buyers get a
confirmation when an order is paid, a note for every monthly subscription
charge, and a "it is in the post" note when a parcel is marked sent. The studio
gets one digest a day listing what still has to go out.

**`BREVO_API_KEY` is optional on purpose.** A missing key — or one that still
contains a placeholder marker like `REPLACE_ME` — is treated as "not
configured": the app boots normally and every send becomes a log line saying
who it *would* have emailed. That way a half-configured deploy never turns a
paid order into a 500.

Every email is at-most-once. `sendEmail` claims a unique `dedupeKey` in the
`emaillogs` collection *before* calling Brevo and releases it again if the call
fails, so a replayed webhook, a retried schedule, and two Lambdas racing each
other cannot double-send, while a genuine provider blip can still be retried.
The keys are `order-confirmation:<orderId>`, `subscription-charge:<sourceKey>`,
`shipped:<fulfillmentId>` and `fulfillment-digest:<YYYY-MM-DD>`.

Sends never throw. They happen on paths that have already taken money, and
failing the Stripe webhook would replay the stock decrement rather than fix the
email.

#### The daily digest

`POST /api/tasks/daily-digest` builds and sends it. It is authorised by a shared
`x-tasks-secret` header rather than the admin cookie, because a scheduler is
calling it; if `TASKS_SECRET` is unset the endpoint 404s rather than running
unauthenticated.

- Nothing outstanding means **no email** — a daily "nothing to do" trains you to
  ignore the ones that matter.
- A subscription line carries the month it was charged for, e.g.
  *"October 2026 — heavenly dispatch"*, so a renewal reads as a job rather than
  a puzzle.
- Anything pending for more than `FULFILLMENT_PAST_DUE_DAYS` (default 3) is
  flagged past due, and the subject says how many.
- Over `DIGEST_MAX_ITEMS` (default 10) the list is dropped entirely in favour of
  a link to the queue, since a 60-row email is not a to-do list.

The link deep-links into the admin at
`?tab=fulfillment&filter=past-due`, which opens the fulfillment tab with the
past-due filter already applied. "Past due" is computed once, server-side, in
`isPastDue()`, so the email and the page can never disagree.

Scheduling is not wired up yet. Once the real key is in place, point any daily
scheduler (EventBridge Scheduler → API destination) at that endpoint with the
`x-tasks-secret` header; running it more than once a day is harmless.

### Subscribers managing themselves

`/manage-subscription` is unlinked from the site; subscribers arrive from the
footer of a renewal email. It lets them change their posting address, cancel, or
un-cancel without an account and without emailing us.

There are no passwords and no signup. You enter your email, and if it has a live
subscription we email a one-time link:

- The credential is a 32-byte random token carried in the link, not a 6-digit
  code. A short numeric code is guessable at a few thousand tries, which would
  mean also building attempt caps and lockouts; a long token sidesteps all of it.
- Only a SHA-256 hash of the token is stored, so the database never holds
  anything that can be replayed.
- Redemption is a single atomic `findOneAndUpdate` filtered on `usedAt: null`,
  so a link works exactly once even if two requests land together.
- Tokens last 20 minutes and the session that replaces them lasts 30, both on a
  TTL index that removes spent rows on its own.
- `request-link` answers `{ok: true}` for addresses we have never seen, so the
  form cannot be used to test whether somebody is a customer. It is throttled per
  IP and per address.
- The page spends the token on arrival and strips it from the URL, so a
  screenshot or a shared link is worthless.

Two behaviours worth knowing:

- **An address change also moves parcels already queued.** Updating the address
  rewrites any `pending` fulfillment for that subscription as well as Stripe and
  the subscription record. Without that, a change made after a renewal would
  apply "from next month" and this month's print would still go to the old house.
  Parcels already marked sent keep the address they were sent to.
- **Cancelling sets `cancel_at_period_end`,** never an instant cancel — they
  paid for the month, so they get the month. "keep it going" reverses it, so a
  misclick is not a support email.

Admin and subscriber sessions are signed with the same `JWT_SECRET`, so each is
issued and verified with a distinct JWT `audience` (`coyv:admin` vs
`coyv:manage`). Without that, a subscriber token would be a structurally valid
admin cookie. **Consequence:** admin cookies issued before this change have no
`aud` and are rejected, so everyone signs in once more after it ships.

### Admin panel

Mounted at `VITE_ADMIN_PATH` (`/studio-back-door` by default) and linked from
nowhere. It is a build-time constant, so changing it means rebuilding the web
image. Sign-in issues an httpOnly, `SameSite=Strict` JWT cookie; there is no
signup route, and login attempts are throttled per IP.

The **products** tab is where you create prints and subscriptions, set prices
and stock, upload artwork, and publish. A product with no images cannot be
published, and deleting one that already appears on a real order — or that
someone actively subscribes to — archives it instead, so history keeps
resolving.

The **subscribers** tab is a read-only mirror of who is subscribed, with their
status and renewal date, so the studio never needs a Stripe login.

The **fulfillment** tab is the parcel queue described above; its badge counts
what is still owed.

Description fields use a small rich text editor — blank line for a new
paragraph, single newline for a line break, plus `**bold**`, `*italic*` and
`[text](url)`, with a preview toggle. It is stored as plain text and parsed
into React elements at render time rather than through
`dangerouslySetInnerHTML`, and link URLs are dropped unless they are plainly
http(s), so no admin-authored text can inject markup into the shop.

The **memories** tab manages the `/memories` gallery: drop in any number of
images, give them captions and alt text, reorder them with the arrows, hide one
without deleting it, or delete it for good. A delete removes the files from S3
too, so it cannot be undone.

### S3

Uploads are proxied through the API (`multipart/form-data`, JPEG/PNG/WebP/AVIF,
`MAX_UPLOAD_BYTES` each) and stored under `products/<slug>/<uuid>` or
`memories/<uuid>`; the client's filename is discarded. The bucket stays
private — image URLs are presigned GETs minted per request and cached
in-process until just before they expire.

Memories are stored twice: the original, which the lightbox and the download
link use, and a 900px WebP built with `sharp` on upload that the grid loads
instead. The originals run 2–4 MB each, so this is the difference between a
30 MB gallery and a 300 KB one. Downloads are presigned with a
`Content-Disposition` of their own, because the HTML `download` attribute is
ignored on a cross-origin URL.

Product artwork is stored twice for a different reason. The original is the
print-resolution file and is **never served publicly**: the public API only
ever presigns a 1200px WebP display copy, so what the vault hands out is not
worth printing. The vault also blocks the context menu and dragging, but that
is a deterrent only — anything a browser renders can be saved, and not serving
the original is the control that actually works.

Images uploaded before display copies existed were backfilled with
`npm run backfill-display-images` (run from `server/`), which builds the
missing copy for any image still lacking one. It is idempotent.

The seven memories that used to ship inside the frontend bundle were moved into
S3 with `npm run import-memories -- --dir ../src/assets/memories` (run from
`server/`). It is idempotent, so a re-run skips anything already imported.

## Production

Live at <https://coyvcastle.com> in AWS account `162956754427` (`us-east-1`).

```
Route 53 (coyvcastle.com, www)
        │
   CloudFront  ──  /*      →  S3 coyv-site-162956754427   (private, OAC)
        │            /api/* →  API Gateway → Lambda coyv-api
        │
   ACM cert (us-east-1, apex + www)
```

Everything is one origin on purpose: the admin cookie is `SameSite=Strict`, so
the API has to answer on the site's own domain. `www` 301s to the apex via the
`coyv-www-redirect` CloudFront Function, which also rewrites extension-less
paths to `/index.html` for client-side routing. That rewrite deliberately skips
`/api/*` so real API 404s reach the browser instead of the app shell.

The API is the same container image as local Docker, with the
[Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter) copied
into `/opt/extensions`; nothing outside Lambda reads that path. Data lives in
the existing MongoDB Atlas cluster (`coyvcastle-dev`), reached by the `coyv_api`
user. Artwork sits in `coyv-assets-162956754427`, served as presigned GETs.

> App Runner and public Lambda Function URLs are both blocked by an
> organisation policy on this account, which is why the API is fronted by API
> Gateway rather than either of those.

### Credentials

`.aws-credentials` (gitignored, repo root) holds an admin key for the account:

```bash
export AWS_SHARED_CREDENTIALS_FILE="$(pwd)/.aws-credentials"
aws --profile coyv-cli sts get-caller-identity
```

Runtime secrets live in Secrets Manager under `coyv/*` and are copied into the
Lambda's environment.

### Deploying a change

```bash
export AWS_SHARED_CREDENTIALS_FILE="$(pwd)/.aws-credentials"
export AWS_PROFILE=coyv-cli AWS_DEFAULT_REGION=us-east-1
REG=162956754427.dkr.ecr.us-east-1.amazonaws.com

# frontend
npm run build
aws s3 sync dist/ s3://coyv-site-162956754427/ --delete --exclude index.html \
  --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html s3://coyv-site-162956754427/index.html \
  --cache-control "no-cache,must-revalidate"
aws cloudfront create-invalidation --distribution-id E1J2EEQCJDHQJV --paths "/*"

# api  (--provenance=false matters: Lambda rejects buildx attestation manifests)
aws ecr get-login-password | docker login --username AWS --password-stdin $REG
docker buildx build --platform linux/amd64 --provenance=false --sbom=false \
  --output type=image,name=$REG/coyv-api:lambda,oci-mediatypes=false,push=true ./server
aws lambda update-function-code --function-name coyv-api \
  --image-uri $REG/coyv-api:lambda
```

### Stripe

Live keys are in place: the Lambda holds the live secret key, and the frontend
bundle carries the live publishable key. `VITE_STRIPE_PUBLISHABLE_KEY` is baked
in at build time, so changing it means rebuilding and re-uploading the SPA.

The live webhook endpoint points at `https://coyvcastle.com/api/stripe/webhook`
and subscribes to `payment_intent.succeeded`, `payment_intent.payment_failed`,
`payment_intent.canceled`, `charge.refunded`,
`customer.subscription.created/updated/deleted`, `invoice.paid` and
`invoice.payment_failed`.

Products and prices are created through the API by the admin panel, so nothing
in the catalogue should be edited in the Stripe dashboard.

Local development uses the sandbox keys in `server/.env` and root `.env`, so no
real charge is possible. Webhooks do not reach localhost on their own; run
`stripe listen --forward-to localhost:4000/api/stripe/webhook` and paste the
secret it prints into `STRIPE_WEBHOOK_SECRET`.

To rotate either secret:

```bash
aws secretsmanager put-secret-value --secret-id coyv/stripe-secret-key \
  --secret-string sk_live_...
# the Lambda reads plain env vars, so it needs the new value too
aws lambda update-function-configuration --function-name coyv-api \
  --environment "Variables={...,STRIPE_SECRET_KEY=sk_live_...}"
```

### Creating or resetting the admin

There is no signup route, so the account is made from the command line against
the production database. Never commit the password.

```bash
export AWS_SHARED_CREDENTIALS_FILE="$(pwd)/.aws-credentials"
export AWS_PROFILE=coyv-cli AWS_DEFAULT_REGION=us-east-1

cd server
MONGODB_URI="$(aws secretsmanager get-secret-value \
    --secret-id coyv/mongodb-uri --query SecretString --output text)" \
MONGODB_DB_NAME=coyv \
JWT_SECRET=unused-by-this-script-but-required-to-be-32-chars \
STRIPE_SECRET_KEY=unused STRIPE_WEBHOOK_SECRET=unused \
S3_BUCKET=coyv-assets-162956754427 \
node src/scripts/createAdmin.ts --email you@example.com --name "Your Name"
```

Omit `--password` and a strong one is generated and printed once. Re-running
for an existing email resets that account's password. Your machine's IP has to
be on the Atlas access list for this to connect.

Sign in at `https://coyvcastle.com/studio-back-door`.
