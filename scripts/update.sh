#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "1/6 Подтягиваю изменения из Git..."
git pull origin main

echo "Предварительно загружаю образ nginx для заглушки..."
docker pull nginx:alpine || true

echo "2/6 Останавливаю основные контейнеры и запускаю страницу-заглушку..."
docker compose -f docker-compose.prod.yml down

# Удаляем старый контейнер-заглушку, если он остался от предыдущего запуска
docker rm -f deploy-placeholder || true

# Запускаем временную заглушку на порту 8080 с конфигурацией роутинга
docker run -d --name deploy-placeholder -p 127.0.0.1:8080:80 -v "$(pwd)/maintenance:/usr/share/nginx/html" -v "$(pwd)/maintenance/nginx.conf:/etc/nginx/conf.d/default.conf" nginx:alpine

# Функция очистки на случай ошибок при сборке
cleanup() {
  echo "Очистка временных ресурсов..."
  docker rm -f deploy-placeholder || true
}
trap cleanup EXIT

echo "3/6 Собираю image collab-python-runner..."
docker build -t collab-python-runner ./runner

echo "4/6 Собираю новые версии сервисов приложения..."
docker compose -f docker-compose.prod.yml build

echo "5/6 Запускаю обновленное приложение..."
# Удаляем заглушку, чтобы освободить порт 8080
docker rm -f deploy-placeholder || true
# Убираем trap, так как ручная очистка выполнена
trap - EXIT

# Запускаем уже собранные сервисы приложения
docker compose -f docker-compose.prod.yml up -d

echo "6/6 Проверяю статус контейнеров..."
docker compose -f docker-compose.prod.yml ps

echo "Готово!"