FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 8080
CMD ["node","src/server.js"]
