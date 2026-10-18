FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY vite.config.ts ./
COPY web ./web
COPY skills ./skills
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 CLERK_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/skills ./skills
COPY --from=build --chown=node:node /app/package*.json ./
COPY --chown=node:node scripts ./scripts
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
