# Convos agent runtime — single OpenClaw instance on Railway
FROM node:22-bookworm@sha256:7e791fc54bd02fc89fd4fb39eb37e5bea753c75679c8022478d81679367d995a
ENV NODE_ENV=production

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    jq \
    ripgrep \
    chromium curl \
    fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 \
    libdrm2 libgbm1 libnspr4 libnss3 libxcomposite1 libxdamage1 libxfixes3 \
    libxkbcommon0 libxrandr2 xdg-utils \
  && rm -rf /var/lib/apt/lists/*

RUN curl -sSf https://ngrok-agent.s3.amazonaws.com/ngrok.asc \
      | tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null \
  && echo "deb https://ngrok-agent.s3.amazonaws.com bookworm main" \
      > /etc/apt/sources.list.d/ngrok.list \
  && apt-get update && apt-get install -y --no-install-recommends ngrok \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@8.7.5

WORKDIR /app

# Install all deps (openclaw now comes from npm via package.json)
COPY runtime/openclaw/package.json runtime/openclaw/pnpm-lock.yaml /app/
RUN pnpm install --frozen-lockfile
ENV NODE_PATH=/app/node_modules

# RUNTIME_DIR=$ROOT/openclaw in init.sh — apply-config syncs from here to STATE_DIR (/app)
COPY runtime/openclaw/openclaw.json /app/openclaw/openclaw.json
COPY runtime/openclaw/workspace /app/openclaw/workspace
COPY runtime/openclaw/extensions /app/openclaw/extensions
COPY runtime/convos-platform /app/convos-platform
COPY runtime/lib /app/lib
COPY runtime/openclaw/scripts ./scripts
# Shared pool server — compile TypeScript at build time
RUN cd /app/convos-platform/pool-server && npm install --ignore-scripts && npx tsc && rm -rf node_modules
COPY runtime/package.json /app/runtime-version.json
COPY runtime/evals ./evals
RUN chmod +x /app/scripts/*.sh /app/scripts/entrypoint.sh

# IMPORTANT: set OPENCLAW_STATE_DIR before running any CLI commands
ENV OPENCLAW_STATE_DIR=/app
ENV SKILLS_ROOT=/app/workspace/skills

ENV OPENCLAW_PUBLIC_PORT=8080
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["./scripts/entrypoint.sh"]
CMD ["pnpm", "start"]
