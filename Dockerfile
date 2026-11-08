# Stage 1: Build frontend
FROM node:22-alpine AS client-builder

WORKDIR /app/apps/client

COPY apps/client/package.json ./package.json

# Vite is a devDependency, so include development dependencies
RUN npm install --include=dev

COPY apps/client/ ./

RUN npm run build


# Stage 2: Production backend
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV SERVE_STATIC=true

# Python execution runs remotely in Vercel Sandbox; the application image needs no Python or Docker runtime.

WORKDIR /app/apps/server

COPY apps/server/package.json ./package.json

# Install only production dependencies
RUN npm install --omit=dev

COPY apps/server/src/ ./src/
COPY apps/server/scripts/ ./scripts/

# Copy compiled frontend from builder
COPY --from=client-builder /app/apps/client/dist/ /app/apps/client/dist/

EXPOSE 4000

CMD ["node", "src/server.js"]