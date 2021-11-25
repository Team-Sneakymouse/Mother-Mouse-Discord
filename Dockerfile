FROM node:16-alpine

WORKDIR /app

VOLUME /app/share

COPY package*.json ./

RUN npm ci --only-production

COPY ./dist/ ./dist/

CMD ["npm", "run", "start"]