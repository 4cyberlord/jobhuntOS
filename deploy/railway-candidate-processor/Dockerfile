FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY server.mjs candidate.mjs ./
EXPOSE 3000
CMD ["node", "server.mjs"]
