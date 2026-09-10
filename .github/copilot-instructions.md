# coyv

The art site at **coyvcastle.com**: a React 19 + TypeScript SPA (Vite) with a
Node/TypeScript API behind it. Prints and monthly subscriptions are sold through
Stripe, artwork lives in S3, records live in MongoDB, and the API runs as a
container on Lambda in AWS account `162956754427` (`us-east-1`).

- `src/` — the SPA. Pages in `src/pages/`, admin panel under `src/pages/admin/`.
- `server/` — the API. Routes, models, services and one-off scripts in
  `server/src/`.
- [`DEPLOYMENT.md`](../DEPLOYMENT.md) — the deploy runbook **and** the list of
  things that have already gone wrong in production. Read it before shipping.

## Commands

```bash
npm run dev     # mongo + api + web together
npm run build   # typecheck and build the SPA (see the Stripe note below)
npm run lint    # oxlint
npm --prefix server run typecheck
```

Lint currently reports warnings but zero errors; keep it that way rather than
fixing unrelated pre-existing warnings.

## Deploying

Use the `deploy` skill. Two things are worth knowing up front because both have
caused a silent production outage:

- **Production is always in live payment mode.** The root `.env` holds a
  `pk_test` key for local work, and a plain `npm run build` would inline it.
  `vite.config.ts` now refuses to finish a production build unless
  `VITE_STRIPE_PUBLISHABLE_KEY` starts with `pk_live_`, so a bare build failing
  is expected — supply the live key as `DEPLOYMENT.md` describes.
- **Every AWS command needs the repo-local credentials block.** Without it the
  SDK silently uses an ambient profile from a different account, and the failure
  names an IAM user in account `813423893927`, which reads like a permissions
  problem rather than a missing export.

## Working on the frontend

- **Mobile breakpoint is `max-width: 768px`.** The painted backdrop, the
  translucent text panels and the nav opacity rules are all keyed to it. Vault
  tiles use `min-width: 769px` for the desktop treatment instead, because they
  are written mobile-first. `.bottomNav` has a separate `480px` block for
  layout — that one is not the mobile breakpoint.
- **`backdrop-filter` must be declared inside `@supports (backdrop-filter:
  blur(1px))`.** The CSS minifier drops a plain `backdrop-filter` sitting next
  to the `-webkit-` prefixed one, which silently loses the frost in Firefox.
  Tidying such a rule back into its main block reintroduces the bug. Do not add
  CSS target configuration to `vite.config.ts` to fix this; neither
  `build.cssTarget` nor `css.lightningcss.targets` has any effect here.
- Product descriptions are **markdown**, rendered through `src/lib/richText.tsx`,
  so links never appear as HTML in the source. Style them in `richText.css`.
- The lightbox renders through a portal onto `document.body`, so it escapes any
  stacking context on the page.

## Working on the API

- Product images are `images: [{ key, displayKey, alt, width, height,
  contentType, bytes }]`; memories use `image: { key, previewKey, contentType,
  bytes }` with `contentType` and `bytes` required.
- `update-function-configuration --environment` **replaces the whole variable
  map**. Always read, merge, then write, or the API loses every other variable.

## Local development

- Local dev **shares the production assets bucket** `coyv-assets-162956754427`.
  Anything uploaded through a local admin session is really in production, and
  deleting objects to tidy up will break the live site if a product or memory
  still references the key.
- The API needs real AWS credentials in `server/.env` to sign S3 URLs; without
  them it falls back to an ambient profile in the wrong account and signs URLs
  that can never work. S3 returns **403, not 404**, for a missing object when
  the caller lacks `s3:ListBucket`, which disguises "missing" as "forbidden".
- Scripts that import from the server or use `sharp` must live **inside
  `server/`**; a script in `/tmp` resolves modules relative to `/tmp` whatever
  the working directory is.
- Mongo is `mongodb://127.0.0.1:27017`, database `coyv`.

## Conventions

- Comments explain **why**, not what, and are used sparingly. Several rules in
  this codebase look like they could be simplified but cannot; those carry a
  comment saying so, and it should survive edits to the surrounding code.
- Record any new deployment learning in `DEPLOYMENT.md` rather than leaving it
  in a session, so the next session starts with it.
