FROM oven/bun:1.3.8-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
# Official zipimport release bundles the matching EJS challenge solver scripts.
# Keep version and checksum together when updating; do not use Alpine's youtube-dl alias.
RUN apk add --no-cache ca-certificates python3 nodejs ffmpeg \
    && node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' \
    && wget -O /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp \
    && printf '%s  %s\n' '1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6' '/usr/local/bin/yt-dlp' | sha256sum -c - \
    && chmod +x /usr/local/bin/yt-dlp \
    && yt-dlp --ignore-config --version

VOLUME /app/share

COPY ./src/ ./src/
COPY ./static/ ./static/

CMD ["bun", "src/bot.ts"]
