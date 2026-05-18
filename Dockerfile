# Build context = monorepo root (workspace deps live there).
#   docker build -t mis/case-service:dev -f mis-case-service/Dockerfile .
FROM node:20-alpine AS builder
WORKDIR /app
# Copy the whole workspace; root .dockerignore prunes node_modules/dist
# so the install inside the image is always clean.
COPY . .
RUN npm install --workspaces --include-workspace-root
RUN npm run build:pkgs
RUN npm run build --workspace mis-case-service

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# Workspace deps are symlinked into node_modules, so the whole
# tree (packages included) must ship to runtime.
COPY --from=builder /app ./
WORKDIR /app/mis-case-service
EXPOSE 3003
CMD ["node", "dist/main.js"]
