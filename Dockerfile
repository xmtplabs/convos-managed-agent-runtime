# --- COMMENTED OUT: Build openclaw from source ---
# Previously built from source to avoid npm packaging gaps.
# Keeping for reference in case we need to go back to a fork/custom build.
#
# FROM node:22-bookworm AS openclaw-build
# RUN apt-get update \
#   && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
#     git ca-certificates curl python3 make g++ \
#   && rm -rf /var/lib/apt/lists/*
# RUN curl -fsSL https://bun.sh/install | bash
# ENV PATH="/root/.bun/bin:${PATH}"
# RUN corepack enable
# WORKDIR /openclaw
# ARG OPENCLAW_CACHE_BUST=1
# ARG OPENCLAW_GIT_REPO=https://github.com/openclaw/openclaw.git
# ARG OPENCLAW_GIT_REF=main
# RUN git clone --depth 1 --branch "${OPENCLAW_GIT_REF}" "${OPENCLAW_GIT_REPO}" .
# RUN cd /openclaw && printf '%s\n' "{\"ref\":\"${OPENCLAW_GIT_REF}\",\"commit\":\"$(git rev-parse HEAD)\"}" > /openclaw/openclaw-version.json
# RUN set -eux; \
#   find ./extensions -name 'package.json' -type f | while read -r f; do \
#     sed -i -E 's/"openclaw"[[:space:]]*:[[:space:]]*">=[^"]+"/"openclaw": "*"/g' "$f"; \
#     sed -i -E 's/"openclaw"[[:space:]]*:[[:space:]]*"workspace:[^"]+"/"openclaw": "*"/g' "$f"; \
#   done
# RUN pnpm install --no-frozen-lockfile
# RUN pnpm build
# ENV OPENCLAW_PREFER_PNPM=1
# RUN pnpm ui:install && pnpm ui:build
# --- END COMMENTED OUT ---

# Runtime image — openclaw installed from npm via package.json
FROM node:22-bookworm
ENV NODE_ENV=production

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    jq \
    ripgrep \
    chromium \
    fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 \
    libdrm2 libgbm1 libnspr4 libnss3 libxcomposite1 libxdamage1 libxfixes3 \
    libxkbcommon0 libxrandr2 xdg-utils \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Install all deps (openclaw now comes from npm via package.json)
COPY package.json pnpm-lock.yaml /app/
RUN pnpm install --no-frozen-lockfile
ENV NODE_PATH=/app/node_modules

COPY workspace /app/workspace-defaults
COPY skills /app/skills
COPY config /app/config-defaults
COPY extensions /app/extensions
COPY landing /app/landing
COPY cli ./cli
RUN chmod +x /app/cli/scripts/*.sh

# State-dir seed: agentmail in state dir so skill scripts resolve from anywhere (no NODE_PATH)
COPY config/state-dir-package.json /app/state-seed/package.json
RUN cd /app/state-seed && pnpm install --no-frozen-lockfile && rm -f package-lock.yaml pnpm-lock.yaml

# Install extension deps
# HUSKY=0 skips husky prepare scripts from GitHub deps
# NODE_ENV must be unset so pnpm runs prepare/build scripts for git-hosted deps
ENV HUSKY=0
RUN set -eux; \
  for f in /app/extensions/*/package.json; do \
    [ -f "$f" ] || continue; \
    (cd "$(dirname "$f")" && NODE_ENV=development pnpm install); \
  done

ENV CHROMIUM_PATH=/usr/bin/chromium
ENV OPENCLAW_CUSTOM_PLUGINS_DIR=/app/extensions
ENV OPENCLAW_PUBLIC_PORT=8080
ENV PORT=8080
EXPOSE 8080
CMD ["pnpm", "start"]
