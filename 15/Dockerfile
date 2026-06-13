FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY tsconfig.json ./
COPY lua/ ./lua/
COPY src/ ./src/
COPY dashboard/ ./dashboard/

RUN npm run build

EXPOSE 3000

CMD ["node", "dist/app.js"]
