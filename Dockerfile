# back-aurum/Dockerfile

# ── Stage 1: deps ─────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: build ────────────────────────────────
FROM node:20-alpine AS builder
# Prisma's query engine binary requires openssl at build time
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate Prisma client for the target platform (linux-musl-openssl-3.0.x)
RUN npx prisma generate
RUN npm run build

# ── Stage 3: production ───────────────────────────
FROM node:20-alpine AS production
# curl for healthcheck, openssl for Prisma query engine + migrate deploy.
# chromium + fonts render invoice PDFs (Devanagari needs font-noto-devanagari).
RUN apk add --no-cache curl openssl chromium nss freetype harfbuzz ca-certificates \
    ttf-freefont font-noto-devanagari
WORKDIR /app
ENV NODE_ENV=production
ENV CHROME_EXECUTABLE_PATH=/usr/bin/chromium

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY package.json ./

EXPOSE 3000
CMD ["node", "dist/main.js"]
