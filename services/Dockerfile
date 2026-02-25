FROM node:22-bookworm-slim

RUN npm install -g pnpm@9

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

ENV PORT=3002
EXPOSE 3002
CMD ["node", "dist/index.js"]
