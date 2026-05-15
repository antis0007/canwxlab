FROM node:22-slim

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml /app/
COPY apps/web/package.json /app/apps/web/package.json
COPY packages/layer-sdk/package.json /app/packages/layer-sdk/package.json
RUN pnpm install --frozen-lockfile=false

COPY apps/web /app/apps/web
COPY packages/layer-sdk /app/packages/layer-sdk

EXPOSE 5173
CMD ["pnpm", "--filter", "@canwxlab/web", "dev", "--host", "0.0.0.0"]
