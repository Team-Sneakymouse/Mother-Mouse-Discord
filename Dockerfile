FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY ./src/ ./src/
COPY tsconfig.json ./
RUN npm run build


FROM node:18-alpine AS production
RUN apk add youtube-dl ffmpeg

WORKDIR /app

VOLUME /app/share

COPY package*.json ./

RUN npm ci --only-production

COPY --from=builder /app/dist/ ./dist/

CMD ["npm", "run", "start"]