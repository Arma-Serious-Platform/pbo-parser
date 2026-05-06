FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install required system dependencies
RUN apt-get update && apt-get install -y \
    liblzo2-2 \
    libvorbis0a \
    libvorbisfile3 \
    libvorbisenc2 \
    libogg0 \
    libuchardet0 \
    && rm -rf /var/lib/apt/lists/*

# Copy DePbo tools files to appropriate system directories
COPY shared/linux/bin/* /usr/local/bin/
COPY shared/linux/lib/* /usr/local/lib/

# Set the library path so the system can find the DePbo shared libraries
ENV LD_LIBRARY_PATH="/usr/local/lib"

# Ensure binaries are executable
RUN chmod +x /usr/local/bin/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["npm", "start"]
