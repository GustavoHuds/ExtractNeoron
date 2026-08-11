# ExtractNeoron dashboard — production image.
# The server never launches a browser (only the local discover.js tool does),
# so Playwright/Chromium is intentionally omitted to keep the image small and
# the attack surface minimal.
FROM node:22-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

# Install only production deps, excluding the optional playwright dependency.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

# App code (catalog is imported at runtime via the dashboard, not baked in).
COPY src ./src
COPY public ./public

# Runtime data dir (mounted as a volume) must be writable by the non-root user.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
