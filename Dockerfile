FROM node:20-slim

# Install system libraries that Chrome/Chromium needs at runtime.
# We keep the 'chromium' package to pull in all transitive deps automatically,
# but puppeteer will use its OWN downloaded Chrome for Testing binary (version-matched).
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libgbm1 \
    libasound2 \
    libgtk-3-0 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Let puppeteer download its own compatible Chrome for Testing during npm ci.
# Do NOT set PUPPETEER_SKIP_CHROMIUM_DOWNLOAD or PUPPETEER_EXECUTABLE_PATH —
# the worker will auto-detect puppeteer's Chrome and prefer it over /usr/bin/chromium.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
ENV PORT=7860

WORKDIR /app

# Copy dependency files
COPY package.json package-lock.json* ./

# Install production dependencies (puppeteer will download Chrome for Testing here)
RUN npm ci --only=production

# Copy worker script
COPY whatsapp-worker.js ./
COPY src/lib/compile-prompt.js ./src/lib/

# Expose Hugging Face Spaces port
EXPOSE 7860

# Run worker
CMD ["node", "whatsapp-worker.js"]
