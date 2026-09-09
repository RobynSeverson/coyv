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
| `GET` | `/api/prints` | published prints only |
| `GET` | `/api/prints/:slug` | |
| `POST` | `/api/checkout/intent` | prices the cart, returns a client secret |
| `GET` | `/api/checkout/orders/lookup` | order status after the Stripe redirect |
| `POST` | `/api/stripe/webhook` | signature-verified, raw body |
| `POST` | `/api/admin/auth/login` `/logout` `/password` | |
| `GET` | `/api/admin/auth/me` | returns `{ admin: null }` when signed out |
| `GET/POST/PATCH/DELETE` | `/api/admin/prints…` | catalogue + image upload |
| `GET` | `/api/admin/orders` | |

### How payments work

1. `/vault` lists published prints; adding one puts it in a `localStorage` cart.
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

Amounts are integer cents everywhere; only the view layer formats them.

### Admin panel

Mounted at `VITE_ADMIN_PATH` (`/studio-back-door` by default) and linked from
nowhere. It is a build-time constant, so changing it means rebuilding the web
image. Sign-in issues an httpOnly, `SameSite=Strict` JWT cookie; there is no
signup route, and login attempts are throttled per IP.

From there you can create prints, set prices and stock, upload artwork, and
publish. A print with no images cannot be published, and deleting one that
already appears on a real order archives it instead so order history keeps
resolving.

### S3

Uploads are proxied through the API (`multipart/form-data`, JPEG/PNG/WebP/AVIF,
`MAX_UPLOAD_BYTES` each) and stored under `prints/<slug>/<uuid>`; the client's
filename is discarded. The bucket stays private — image URLs are presigned
GETs minted per request and cached in-process until just before they expire.

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

### Turning on Stripe

Payments are deployed with placeholder keys, so checkout stays disabled until
real ones are set. After signing up:

```bash
aws lambda update-function-configuration --function-name coyv-api \
  --environment "Variables={...,STRIPE_SECRET_KEY=sk_...,STRIPE_WEBHOOK_SECRET=whsec_...}"
```

Point the Stripe webhook endpoint at `https://coyvcastle.com/api/stripe/webhook`
and use its signing secret. `VITE_STRIPE_PUBLISHABLE_KEY` is baked in at build
time, so the frontend needs a rebuild and re-upload to pick up the public key.
