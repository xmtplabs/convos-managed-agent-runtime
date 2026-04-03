FROM node:22-bookworm-slim@sha256:80fdb3f57c815e1b638d221f30a826823467c4a56c8f6a8d7aa091cd9b1675ea

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
