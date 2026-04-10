FROM node:24-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c

RUN npm install -g pnpm@8.7.5

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY frontend ./frontend
COPY data ./data
COPY drizzle ./drizzle

ENV PORT=3001
EXPOSE 3001
CMD ["npx", "tsx", "src/index.ts"]
