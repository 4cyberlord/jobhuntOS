FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY server.mjs gateway.mjs ./
EXPOSE 8080
CMD ["node", "server.mjs"]
