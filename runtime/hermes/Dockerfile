# Convos agent runtime — Hermes agent on Railway
FROM python:3.11-bookworm@sha256:12e6e9b778363eaa84d39ec79d7ee55cc2a5fc6934e1cc89a2f041637c028ba7

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# System deps + Node.js 22 (for convos CLI)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl git jq ripgrep \
    chromium fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libcups2 libdrm2 libgbm1 libnspr4 libnss3 libxcomposite1 libxdamage1 \
    libxfixes3 libxkbcommon0 libxrandr2 xdg-utils \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y nodejs \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@8.7.5

WORKDIR /app

# uv — fast Python package manager (recommended by Hermes project)
RUN curl -LsSf https://astral.sh/uv/0.11.2/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# FastAPI + uvicorn (runtime server deps)
COPY runtime/hermes/requirements.txt runtime/hermes/requirements.lock /app/
RUN uv pip install --system --no-cache -r requirements.lock

# Node dependencies (convos CLI only)
COPY runtime/hermes/package.json runtime/hermes/pnpm-lock.yaml /app/
RUN CI=true pnpm install --frozen-lockfile
ENV NODE_PATH=/app/node_modules
ENV PATH="/app/node_modules/.bin:${PATH}"

# Hermes agent — clone with submodules and install per project instructions.
# The agent/ package isn't in pyproject.toml's packages.find, so the full
# source tree must stay on PYTHONPATH.
# Tag must match HERMES_TAG in scripts/install-deps.sh.
RUN git clone --recurse-submodules --branch v2026.3.30 --depth 1 https://github.com/NousResearch/hermes-agent.git /opt/hermes-agent \
  && cd /opt/hermes-agent \
  && uv pip install --system ".[cron,mcp,pty,homeassistant]"
ENV PYTHONPATH="/opt/hermes-agent"

# Runtime version (shared root package.json)
COPY runtime/package.json /app/runtime-version.json

# Application code
COPY runtime/hermes/src /app/src
COPY runtime/convos-platform /app/convos-platform
COPY runtime/harness /app/harness
COPY runtime/hermes/workspace /app/workspace
COPY runtime/hermes/scripts /app/scripts
RUN chmod +x /app/scripts/*.sh

# HERMES_HOME — sync.sh populates this on boot from /app/workspace
ENV HERMES_HOME=/app/.hermes
ENV SKILLS_ROOT=/app/.hermes/skills

ENV PORT=8080

EXPOSE 8080

ENTRYPOINT ["/app/scripts/entrypoint.sh"]
CMD ["pnpm", "start"]
