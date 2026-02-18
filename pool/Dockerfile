FROM node:22-bookworm-slim

RUN corepack enable

WORKDIR /app

COPY pool/package.json pool/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY pool/src ./src

ENV PORT=3001
EXPOSE 3001
CMD ["node", "src/index.js"]
