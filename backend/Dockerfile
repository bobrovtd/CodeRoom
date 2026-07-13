FROM dh-mirror.gitverse.ru/library/node:24-slim

WORKDIR /app
COPY package*.json .npmrc ./
RUN npm install
COPY . .

EXPOSE 4000
CMD ["npm", "run", "dev"]
