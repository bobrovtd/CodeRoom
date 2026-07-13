# Production Deploy

The production domain is `code-room.bob-srv.ru`. In `docker-compose.prod.yml`, use `https://code-room.bob-srv.ru` for `CLIENT_ORIGIN` and `VITE_API_URL`, and `wss://code-room.bob-srv.ru` for `VITE_WS_URL`.

Build the Python runner image:

```sh
docker build -t collab-python-runner ./runner
```

Start production services:

```sh
docker compose -f docker-compose.prod.yml up -d --build
```

Follow logs:

```sh
docker compose -f docker-compose.prod.yml logs -f
```

For HTTPS, put an external Nginx or Caddy in front of this compose stack on the VPS, or extend the compose file later. When HTTPS is enabled, the frontend WebSocket URL must use `wss://`.

The backend mounts `/var/run/docker.sock` to run code in Docker. This is powerful and unsafe for a public product unless the host and runner isolation are hardened.
