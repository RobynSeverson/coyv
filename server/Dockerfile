# syntax=docker/dockerfile:1

# ---- build -------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime -----------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# --omit=dev keeps typescript and the type packages out of the image.
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Lets the exact same image also run on Lambda behind a Function URL: the
# adapter is a Lambda extension that proxies invocations to the HTTP server.
# Outside Lambda nothing reads /opt/extensions, so this is inert locally.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter
ENV AWS_LWA_READINESS_CHECK_PATH=/api/health
ENV AWS_LWA_PORT=4000

# Never run the API as root; the image has no reason to write anywhere.
USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
