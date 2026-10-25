FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/mcp/package.json ./packages/mcp/package.json
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node packages/mcp ./packages/mcp
COPY --chown=node:node scripts/claude-mcp-http.ts ./scripts/claude-mcp-http.ts

ENV NODE_ENV=production
USER node

EXPOSE 8080
CMD ["node", "scripts/claude-mcp-http.ts", "--host", "0.0.0.0"]
