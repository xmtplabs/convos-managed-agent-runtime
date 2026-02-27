FROM node:22-bookworm
ENV NODE_ENV=production

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    jq \
    ripgrep \
    chromium \
    fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 \
    libdrm2 libgbm1 libnspr4 libnss3 libxcomposite1 libxdamage1 libxfixes3 \
    libxkbcommon0 libxrandr2 xdg-utils \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@9

WORKDIR /app

# Install all deps (openclaw now comes from npm via package.json)
COPY runtime/package.json runtime/pnpm-lock.yaml /app/
RUN pnpm install --no-frozen-lockfile
ENV NODE_PATH=/app/node_modules

# RUNTIME_DIR=$ROOT/openclaw in paths.sh — apply-config syncs from here to STATE_DIR (/app)
COPY runtime/openclaw/openclaw.json /app/openclaw/openclaw.json
COPY runtime/openclaw/workspace /app/openclaw/workspace
COPY runtime/openclaw/extensions /app/openclaw/extensions
RUN mkdir -p /app/openclaw/extensions/voice-call && cp -r /app/node_modules/@openclaw/voice-call/* /app/openclaw/extensions/voice-call/
COPY runtime/scripts ./scripts
RUN chmod +x /app/scripts/*.sh /app/scripts/entrypoint.sh

# IMPORTANT: set OPENCLAW_STATE_DIR before running any CLI commands
ENV OPENCLAW_STATE_DIR=/app

ENV CHROMIUM_PATH=/usr/bin/chromium
ENV OPENCLAW_PUBLIC_PORT=8080
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["./scripts/entrypoint.sh"]
CMD ["pnpm", "start"]
