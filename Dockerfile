# syntax=docker/dockerfile:1
# Builder uses the build machine arch (fast npm/tsc). Runner is amd64: `derap` and `parse2json` are x86-64 ELFs.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends rsync \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM --platform=linux/amd64 node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Shared libraries some DePbo/derap builds expect at link time (bundled .so may depend on these).
RUN apt-get update && apt-get install -y --no-install-recommends \
    liblzo2-2 \
    libvorbis0a \
    libvorbisfile3 \
    libvorbisenc2 \
    libogg0 \
    libuchardet0 \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# PboService uses cwd-relative paths: src/shared/linux/bin/derap, src/shared/parse2json, src/temp.
# Those assets are emitted under dist/shared by the build (rsync + tsc).
RUN mkdir -p src/temp \
  && cp -a dist/shared src/shared \
  && chmod +x src/shared/linux/bin/derap src/shared/parse2json

EXPOSE 3000

CMD ["npm", "start"]
