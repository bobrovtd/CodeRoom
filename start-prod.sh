#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
