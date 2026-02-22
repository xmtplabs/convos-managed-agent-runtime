FROM node:22-bookworm-slim

RUN corepack enable

WORKDIR /app

COPY pool/package.json pool/pnpm-lock.yaml ./
RUN corepack install && pnpm install --frozen-lockfile

COPY pool/src ./src

EXPOSE 8080
CMD ["node", "src/index.js"]
