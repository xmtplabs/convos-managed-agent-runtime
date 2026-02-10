# Build openclaw from source to avoid npm packaging gaps (some dist files are not shipped).
FROM node:22-bookworm AS openclaw-build

# Dependencies needed for openclaw build
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

# Install Bun (openclaw build uses it)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /openclaw

# Configurable OpenClaw source - upstream openclaw main
# Bump OPENCLAW_CACHE_BUST to force a fresh clone (invalidates Docker cache)
ARG OPENCLAW_CACHE_BUST=1
ARG OPENCLAW_GIT_REPO=https://github.com/openclaw/openclaw.git
ARG OPENCLAW_GIT_REF=main
RUN git clone --depth 1 --branch "${OPENCLAW_GIT_REF}" "${OPENCLAW_GIT_REPO}" .

# Patch: relax version requirements for packages that may reference unpublished versions.
# Apply to all extension package.json files to handle workspace protocol (workspace:*).
RUN set -eux; \
  find ./extensions -name 'package.json' -type f | while read -r f; do \
    sed -i -E 's/"openclaw"[[:space:]]*:[[:space:]]*">=[^"]+"/"openclaw": "*"/g' "$f"; \
    sed -i -E 's/"openclaw"[[:space:]]*:[[:space:]]*"workspace:[^"]+"/"openclaw": "*"/g' "$f"; \
  done

RUN pnpm install --no-frozen-lockfile
RUN pnpm build
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:install && pnpm ui:build


# Runtime image
FROM node:22-bookworm
ENV NODE_ENV=production

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    jq \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy built openclaw
COPY --from=openclaw-build /openclaw /openclaw

# Provide an openclaw executable
RUN printf '%s\n' '#!/usr/bin/env bash' 'exec node /openclaw/dist/entry.js "$@"' > /usr/local/bin/openclaw \
  && chmod +x /usr/local/bin/openclaw

# Concierge: package.json (skill deps e.g. agentmail), workspace, config, extensions, entrypoint
COPY package.json pnpm-lock.yaml /app/
RUN pnpm install --no-frozen-lockfile
COPY workspace /app/workspace-defaults
COPY config /app/config-defaults
COPY extensions /app/extensions
COPY scripts ./scripts
RUN chmod +x /app/scripts/entrypoint.sh

# Custom extensions: patch openclaw dep (workspace:* -> file:/openclaw) and install deps
RUN set -eux; \
  for f in /app/extensions/*/package.json; do \
    [ -f "$f" ] || continue; \
    sed -i -E 's/"openclaw"[[:space:]]*:[[:space:]]*"(workspace:[^"]*|\*)"/"openclaw": "file:\/openclaw"/g' "$f"; \
    (cd "$(dirname "$f")" && pnpm install); \
  done

ENV OPENCLAW_BUNDLED_PLUGINS_DIR=/openclaw/extensions
ENV OPENCLAW_CUSTOM_PLUGINS_DIR=/app/extensions
ENV OPENCLAW_PUBLIC_PORT=8080
ENV PORT=8080
EXPOSE 8080
CMD ["./scripts/entrypoint.sh"]
