FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY blip.js ./
USER node
CMD ["node", "blip.js"]
