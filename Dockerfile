# syntax=docker/dockerfile:1

# ---- build -------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* at build time, so these have to arrive as build args
# rather than as runtime environment variables.
ARG VITE_STRIPE_PUBLISHABLE_KEY=""
ARG VITE_ADMIN_PATH="/studio-back-door"
ARG VITE_API_BASE_URL=""
ENV VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY \
    VITE_ADMIN_PATH=$VITE_ADMIN_PATH \
    VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# ---- runtime -----------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://127.0.0.1/ || exit 1
