# Multi-stage Dockerfile for the Paper Submission System
# Build stage installs all deps including native sqlite3 bindings,
# then the runtime stage copies the built node_modules into a slim image.

FROM node:20-bookworm AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=10000
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p data uploads
EXPOSE 10000
# Migrate, seed, then start.
CMD ["sh", "-c", "node src/db/migrate.js && node src/db/seed.js && node src/server.js"]
