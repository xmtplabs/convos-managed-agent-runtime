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
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Install all deps (openclaw now comes from npm via package.json)
COPY package.json pnpm-lock.yaml /app/
RUN pnpm install --no-frozen-lockfile

COPY workspace /app/workspace-defaults
COPY config /app/config-defaults
COPY extensions /app/extensions
COPY landing /app/landing
COPY scripts ./scripts
RUN chmod +x /app/scripts/entrypoint.sh

# Install extension deps
RUN set -eux; \
  for f in /app/extensions/*/package.json; do \
    [ -f "$f" ] || continue; \
    (cd "$(dirname "$f")" && pnpm install); \
  done

ENV OPENCLAW_CUSTOM_PLUGINS_DIR=/app/extensions
ENV OPENCLAW_PUBLIC_PORT=8080
ENV PORT=8080
EXPOSE 8080
CMD ["./scripts/entrypoint.sh"]
