#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "1/5 Подтягиваю изменения из Git..."
git pull origin main

echo "2/5 Останавливаю контейнеры..."
docker compose -f docker-compose.prod.yml down

echo "3/5 Собираю image collab-python-runner..."
docker build -t collab-python-runner ./runner

echo "4/5 Запускаю проект..."
docker compose -f docker-compose.prod.yml up -d --build

echo "5/5 Проверяю статус контейнеров..."
docker compose -f docker-compose.prod.yml ps

echo "Готово!"