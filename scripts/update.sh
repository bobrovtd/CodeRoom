#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "1/6 Подтягиваю изменения из Git..."
git pull origin main

echo "Предварительно загружаю образ nginx для заглушки..."
docker pull nginx:alpine || true

echo "2/6 Останавливаю все контейнеры и запускаю страницу-заглушку..."

# Останавливаем ВСЕ контейнеры проекта (включая dev и prod)
docker compose -f docker-compose.yml down --remove-orphans 2>/dev/null || true
docker compose -f docker-compose.prod.yml down --remove-orphans 2>/dev/null || true

# Явно удаляем ВСЕ контейнеры с именами проекта
docker ps -a --filter "name=coderoom" -q | xargs -r docker rm -f 2>/dev/null || true

# Удаляем старый контейнер-заглушку
docker rm -f deploy-placeholder 2>/dev/null || true

# Запускаем временную заглушку
docker run -d --name deploy-placeholder \
  -p 127.0.0.1:8080:80 \
  -v "$(pwd)/maintenance:/usr/share/nginx/html" \
  -v "$(pwd)/maintenance/nginx.conf:/etc/nginx/conf.d/default.conf" \
  nginx:alpine

# Функция очистки на случай ошибок при сборке
cleanup() {
  echo "⚠️ Ошибка! Очистка временных ресурсов..."
  docker rm -f deploy-placeholder 2>/dev/null || true
}
trap cleanup ERR EXIT

echo "3/6 Собираю image collab-python-runner..."
docker build -t collab-python-runner ./runner

echo "4/6 Собираю новые версии сервисов приложения..."
docker compose -f docker-compose.prod.yml build

echo "5/6 Запускаю обновленное приложение..."

# Удаляем заглушку
docker rm -f deploy-placeholder 2>/dev/null || true
trap - ERR EXIT

# Запускаем новые контейнеры
docker compose -f docker-compose.prod.yml up -d

echo "6/6 Проверяю статус контейнеров..."
docker compose -f docker-compose.prod.yml ps

echo "✅ Готово! Приложение обновлено."