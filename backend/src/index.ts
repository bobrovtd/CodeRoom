import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { createRoom, getRoom, serializeRoom } from './rooms.js';
import { attachRealtime, runAndBroadcast } from './realtime.js';

const app = express();
const server = http.createServer(app);
const port = Number(process.env.PORT || 4000);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (allowedOrigins.includes('*')) {
  throw new Error('ALLOWED_ORIGINS must contain explicit origins, not "*"');
}

if (allowedOrigins.length > 0) {
  app.use(cors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin))
  }));
}
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/rooms', (_req, res) => {
  const room = createRoom();
  res.status(201).json({ roomId: room.roomId });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ message: 'Комната не найдена' });
    return;
  }
  res.json(serializeRoom(room));
});

app.post('/api/rooms/:roomId/run', async (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ message: 'Комната не найдена' });
    return;
  }

  try {
    const result = await runAndBroadcast(room, String(req.body.fileId || ''));
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'Ошибка запуска' });
  }
});

attachRealtime(server);

server.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
