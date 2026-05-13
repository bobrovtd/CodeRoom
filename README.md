# Collab Code Platform

Минимальный MVP веб-платформы для совместного написания и запуска Python-кода в учебных комнатах.

## Стек

- Frontend: React, TypeScript, Vite, Monaco Editor, Yjs, y-monaco, y-websocket.
- Backend: Node.js, TypeScript, Express, ws.
- Runner: Docker image с Python 3.12.
- Хранение: память backend-процесса, без базы данных.

## Структура

```text
CodeRoom/
  frontend/
  backend/
  runner/
  docker-compose.yml
  README.md
```

## Установка зависимостей

Из корня проекта:

```bash
npm run install:all
```

Или отдельно:

```bash
cd backend
npm install

cd ../frontend
npm install
```

## Сборка Docker runner

Docker должен быть установлен и запущен.

```bash
docker build -t collab-python-runner ./runner
```

Пользовательский Python-код запускается только через этот Docker image.

## Запуск backend

```bash
cd backend
npm run dev
```

Backend будет доступен на:

```text
http://localhost:4000
```

REST API:

- `POST /api/rooms`
- `GET /api/rooms/:roomId`
- `POST /api/rooms/:roomId/run`

WebSocket:

- `ws://localhost:4000/ws` для событий комнаты.
- `ws://localhost:4000/yjs/:roomId` для Yjs/Monaco синхронизации.

## Запуск frontend

Во втором терминале:

```bash
cd frontend
npm run dev
```

Откройте:

```text
http://localhost:5173
```

## Docker Compose

Можно запустить frontend и backend через compose:

```bash
docker build -t collab-python-runner ./runner
docker compose up
```

На Windows/macOS Docker Desktop должен разрешать доступ к Docker socket/engine для backend-контейнера. Если это неудобно, запускайте backend локально через `npm run dev`.

## Как проверить MVP

1. Откройте `http://localhost:5173`.
2. Нажмите `Создать комнату`.
3. Введите имя пользователя.
4. Скопируйте ссылку комнаты и откройте ее во втором окне браузера.
5. Введите другое имя.
6. Проверьте, что оба пользователя видят друг друга в верхней панели.
7. Отредактируйте `main.py` в одном окне и убедитесь, что текст появился во втором.
8. Создайте файлы `.py` и `.txt`.
9. Переключитесь между файлами, переименуйте и удалите один из них.
10. Убедитесь, что `.py` открыт с Python-подсветкой, а `.txt` как plaintext.
11. Поставьте курсор или выделите текст во втором окне, чтобы увидеть awareness другого пользователя.
12. Нажмите `Запустить` для Python-файла.
13. Проверьте, что stdout/stderr и статус запуска видны всем участникам.
14. Запустите код с ошибкой, например `raise Exception("test")`.
15. Запустите бесконечный цикл `while True: pass` и проверьте timeout через 5 секунд.
16. Попробуйте запустить `.txt` файл, должна появиться ошибка.

## Безопасность запуска кода

Backend запускает код через Docker Engine API в отдельном контейнере:

```text
collab-python-runner with network none, 128 MB memory, 0.5 CPU and 5s timeout
```

Ограничения:

- код не выполняется напрямую через Node.js или локальный Python;
- сеть в контейнере отключена;
- память ограничена 128 MB;
- CPU ограничен до 0.5;
- timeout выполнения 5 секунд;
- в контейнер копируется только временный `main.py`;
- контейнер удаляется после запуска.

## Ограничения MVP

- Данные комнат хранятся только в памяти backend.
- После перезапуска сервера комнаты пропадают.
- Нет авторизации, ролей, личных кабинетов и истории изменений.
- Нет дебаггера.
- Поддерживаются только `.py` и `.txt`.
- Масштабирование на несколько backend-инстансов не реализовано.

## Что можно улучшить дальше

- Персистентное хранение комнат и файлов.
- Автоматическое восстановление JSON WebSocket после разрыва.
- Очистка неактивных комнат.
- Более строгий sandbox через отдельный runner service.
- Лимиты на размер кода и вывод программы.
- Тесты API и e2e-сценарии для двух клиентов.
