FROM oven/bun:1.3.8-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
RUN apk add youtube-dl ffmpeg

VOLUME /app/share

COPY ./src/ ./src/
COPY ./static/ ./static/

CMD ["bun", "src/bot.ts"]
