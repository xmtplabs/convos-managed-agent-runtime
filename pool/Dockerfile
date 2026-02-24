FROM node:22-bookworm-slim

RUN npm install -g pnpm@9

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY src ./src

ENV PORT=3001
EXPOSE 3001
CMD ["node", "src/index.js"]
