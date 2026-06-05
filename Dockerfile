FROM node:20-slim

# Install system dependencies for Chromium
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

# Skip downloading chromium binaries during puppeteer install
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PORT=7860

WORKDIR /app

# Copy dependency files
COPY package.json package-lock.json* ./

# Install production dependencies only to save build time and memory
RUN npm ci --only=production

# Copy worker script
COPY whatsapp-worker.js ./

# Expose Hugging Face Spaces port
EXPOSE 7860

# Run worker
CMD ["node", "whatsapp-worker.js"]
