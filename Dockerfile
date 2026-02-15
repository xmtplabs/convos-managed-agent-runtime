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

# RUNTIME_DIR=$ROOT/openclaw in paths.sh — apply-config syncs from here to STATE_DIR (/app)
COPY openclaw/openclaw.json /app/openclaw/openclaw.json
COPY openclaw/workspace /app/openclaw/workspace
COPY openclaw/skills /app/openclaw/skills
COPY openclaw/extensions /app/openclaw/extensions
COPY cli ./cli
RUN chmod +x /app/cli/scripts/*.sh

# Sync templates to state dir so install-state-deps sees extensions/skills
RUN OPENCLAW_STATE_DIR=/app pnpm run cli -- apply-config

# Install extension/skill deps in state dir (/app)
# husky must be globally available so git-hosted packages with a "prepare": "husky"
# script don't fail; HUSKY=0 makes it exit immediately without installing hooks.
ENV HUSKY=0
RUN npm install -g husky && OPENCLAW_STATE_DIR=/app pnpm run install-state-deps

ENV CHROMIUM_PATH=/usr/bin/chromium
ENV OPENCLAW_PUBLIC_PORT=8080
ENV PORT=8080
EXPOSE 8080
CMD ["pnpm", "start"]
