---
name: deploy
description: Deploy the coyv site (coyvcastle.com) to AWS - build and ship the React SPA to S3/CloudFront, and/or build and push the API container to Lambda. Use when asked to deploy, ship, release, push to production, roll back, or verify what is live.
---

# Deploying coyv

Everything ships to AWS account `162956754427` in `us-east-1`.
[`DEPLOYMENT.md`](../../../DEPLOYMENT.md) in the repo root is the full runbook
and the record of what has gone wrong before; this skill is the working order of
operations. Read the runbook when anything here fails or looks unfamiliar.

## 1. Credentials, in every shell

Each `bash` call starts a fresh process, so exports do not persist. Every AWS
command needs these:

```bash
export AWS_SHARED_CREDENTIALS_FILE="$(pwd)/.aws-credentials"
export AWS_PROFILE=coyv-cli AWS_DEFAULT_REGION=us-east-1
aws sts get-caller-identity --query Account --output text   # must print 162956754427
```

`coyv-cli` is defined in the repo-local `.aws-credentials`, not `~/.aws`, so
setting only `AWS_PROFILE` fails with "config profile could not be found".
Skipping the block is worse: commands run as an ambient identity and fail with
`AccessDenied` naming a user in account `813423893927`. **Any AWS error
mentioning an account other than `162956754427` means this step was skipped.**

## 2. Decide what to deploy

| Changed | Deploy |
| --- | --- |
| `src/**`, `index.html`, `vite.config.ts` | frontend only |
| `server/**` | API only |
| both | **API first**, then the frontend |

API first, because CloudFront serves the new bundle the moment the invalidation
lands and any visitor mid-session gets 404s until the Lambda catches up. Changes
to `README.md`, `DEPLOYMENT.md`, `.env.example` or this skill ship nothing.

## 3. Frontend

Production is **always** live payments. `.env` holds a `pk_test` key for local
work; `vite.config.ts` fails the production build unless the key is `pk_live_`,
so a bare `npm run build` failing is the guard working, not a broken repo. The
deployed bundle is the source of truth for the live key, so no dashboard login
is needed:

```bash
HASH=$(curl -s https://coyvcastle.com/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
curl -s "https://coyvcastle.com/$HASH" | grep -o 'pk_live_[A-Za-z0-9]\+' | head -1 > /tmp/pk.txt

VITE_STRIPE_PUBLISHABLE_KEY="$(cat /tmp/pk.txt)" npm run build

grep -c pk_live_ dist/assets/index-*.js   # expect 1
grep -c pk_test_ dist/assets/index-*.js   # expect 0
```

Then upload. The two steps are deliberate: Vite fingerprints assets so they can
be cached forever, but `index.html` never changes name and must never be cached,
or browsers keep requesting bundle hashes that `--delete` has just removed and
the site white-screens.

```bash
aws s3 sync dist/ s3://coyv-site-162956754427/ --delete --exclude index.html \
  --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html s3://coyv-site-162956754427/index.html \
  --cache-control "no-cache,must-revalidate"
aws cloudfront create-invalidation --distribution-id E1J2EEQCJDHQJV --paths "/*"
```

Delete `/tmp/pk.txt` afterwards.

## 4. API

```bash
REG=162956754427.dkr.ecr.us-east-1.amazonaws.com
aws ecr get-login-password | docker login --username AWS --password-stdin $REG

docker buildx build --platform linux/amd64 --provenance=false --sbom=false \
  --output type=image,name=$REG/coyv-api:lambda,oci-mediatypes=false,push=true ./server

aws lambda update-function-code --function-name coyv-api --image-uri $REG/coyv-api:lambda
aws lambda wait function-updated --function-name coyv-api
```

`--platform linux/amd64` is not optional. The Lambda is x86_64, and an arm64
image builds, pushes, deploys and reports `LastUpdateStatus: Successful` before
returning 500 on every request with `Extension.LaunchError`. This has taken
production down before. `--provenance=false --sbom=false` are equally required;
without them buildx pushes an attestation index Lambda refuses.

**`LastUpdateStatus: Successful` only means the image was accepted, not that it
runs.** Always verify.

## 5. Verify

```bash
curl -sf https://coyvcastle.com/api/health
curl -so /dev/null -w '%{http_code}\n' https://coyvcastle.com/api/products
curl -so /dev/null -w '%{http_code}\n' https://coyvcastle.com/api/admin/fulfillments  # expect 401
curl -s https://coyvcastle.com/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

A 401 from the admin route is a pass — it proves the route exists and auth is
wired. A 500 or 403 is not. For the frontend, confirm the bundle hash actually
changed; invalidations take a minute or two.

## Rolling back

ECR images are immutable by digest, so redeploy the previous one with
`update-function-code --image-uri $REG/coyv-api@sha256:<digest>`. The frontend
has no equivalent, because `s3 sync --delete` destroys the old assets — roll
back by rebuilding from the previous commit and deploying again.

## After deploying

Record anything newly learned in `DEPLOYMENT.md`, and update this skill if the
order of operations itself changed.
