FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY worker.mjs queue.mjs ./
CMD ["node", "worker.mjs"]
