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

COPY openclaw/openclaw.json /app/openclaw.json
COPY openclaw/workspace /app/workspace
COPY openclaw/skills /app/skills
COPY openclaw/extensions /app/extensions
COPY openclaw/landing /app/landing
COPY cli ./cli
RUN chmod +x /app/cli/scripts/*.sh

# CLI needs commander/dotenv (devDependencies); install before install-state-deps
RUN pnpm install --include=dev

# Install extension/skill deps in state dir (/app)
ENV HUSKY=0
RUN OPENCLAW_STATE_DIR=/app NODE_ENV=development pnpm run install-state-deps

ENV CHROMIUM_PATH=/usr/bin/chromium
ENV OPENCLAW_PUBLIC_PORT=8080
ENV PORT=8080
EXPOSE 8080
CMD ["pnpm", "start"]
