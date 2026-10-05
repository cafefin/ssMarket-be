FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
