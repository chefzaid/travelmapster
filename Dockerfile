# syntax=docker/dockerfile:1

ARG NODE_IMAGE=docker.io/library/node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Kaniko runs inside the Alpine CI tools image, whose /etc/alpine-release makes
# node-gyp-build pick musl prebuilds; this Debian stage needs the glibc ones.
RUN LIBC=glibc npm ci --omit=dev --ignore-scripts=false --no-audit --no-fund \
    && npm cache clean --force

FROM ${NODE_IMAGE} AS runtime
# Pick up Debian security fixes newer than the pinned base image, and drop
# npm, corepack and yarn: the app runs with plain node, so they are only attack surface.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
        /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
ENV NODE_ENV=production \
    PORT=3000 \
    METRICS_PORT=9464
WORKDIR /app
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --chown=root:root package.json VERSION ./
COPY --chown=root:root src ./src
COPY --chown=root:root public ./public

# Files stay root-owned and read-only; the app runs as an unprivileged user.
USER 10001:10001
EXPOSE 3000 9464
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "src/server.js"]
