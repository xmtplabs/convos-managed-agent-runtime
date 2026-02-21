FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@8.7.5 --activate

WORKDIR /app

COPY pool/package.json pool/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY pool/src ./src

EXPOSE 8080
CMD ["node", "src/index.js"]
