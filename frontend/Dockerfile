FROM dh-mirror.gitverse.ru/library/node:24-slim

WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci
COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
