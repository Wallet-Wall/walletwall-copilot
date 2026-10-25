FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/mcp/package.json ./packages/mcp/package.json
RUN npm ci --omit=dev

COPY packages/mcp ./packages/mcp
COPY scripts/claude-mcp-http.ts ./scripts/claude-mcp-http.ts

ENV NODE_ENV=production

CMD ["sh", "-c", "node scripts/claude-mcp-http.ts --host 0.0.0.0 --port ${PORT:-8080}"]
