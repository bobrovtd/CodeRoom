import { nanoid } from 'nanoid';
import * as Y from 'yjs';
import type { Room, RoomFile, RunResult, User } from './types.js';

const rooms = new Map<string, Room>();
const docs = new Map<string, Y.Doc>();
const colors = ['#f97316', '#22c55e', '#38bdf8', '#a78bfa', '#f43f5e', '#eab308', '#14b8a6'];

const defaultRun: RunResult = {
  status: 'idle',
  stdout: '',
  stderr: '',
  exitCode: null
};

export function detectLanguage(name: string) {
  if (name.endsWith('.py')) return 'python' as const;
  if (name.endsWith('.txt')) return 'plaintext' as const;
  return null;
}

export function validateFileName(room: Room, name: string, ignoreFileId?: string) {
  const cleanName = name.trim();
  if (!cleanName) return 'Имя файла не может быть пустым';
  if (cleanName.includes('/') || cleanName.includes('\\')) return 'Папки не поддерживаются';
  if (!detectLanguage(cleanName)) return 'Поддерживаются только файлы .py и .txt';
  const duplicate = room.files.some((file) => file.name === cleanName && file.id !== ignoreFileId);
  if (duplicate) return 'Файл с таким именем уже существует';
  return null;
}

export function getRoom(roomId: string) {
  return rooms.get(roomId);
}

export function getRoomDoc(roomId: string) {
  let doc = docs.get(roomId);
  if (!doc) {
    doc = new Y.Doc();
    docs.set(roomId, doc);
  }
  return doc;
}

export function createRoom() {
  const roomId = nanoid(8);
  const fileId = nanoid(10);
  const mainFile: RoomFile = {
    id: fileId,
    name: 'main.py',
    language: 'python',
    content: 'print("Hello, world!")\n'
  };
  const room: Room = {
    roomId,
    files: [mainFile],
    activeFileId: fileId,
    users: [],
    clients: new Map(),
    lastRun: { ...defaultRun }
  };
  rooms.set(roomId, room);

  const doc = getRoomDoc(roomId);
  const text = doc.getText(`file:${fileId}`);
  text.insert(0, mainFile.content);

  return room;
}

export function serializeRoom(room: Room) {
  return {
    roomId: room.roomId,
    files: serializeFiles(room),
    activeFileId: room.activeFileId,
    users: room.users,
    lastRun: room.lastRun
  };
}

export function serializeFiles(room: Room) {
  const doc = getRoomDoc(room.roomId);
  return room.files.map((file) => ({
    ...file,
    content: doc.getText(`file:${file.id}`).toString()
  }));
}

export function addUser(room: Room, user: User) {
  room.users = room.users.filter((existing) => existing.clientId !== user.clientId);
  room.users.push(user);
}

export function removeUser(room: Room, clientId: string) {
  room.users = room.users.filter((user) => user.clientId !== clientId);
  room.clients.delete(clientId);
}

export function nextColor(index: number) {
  return colors[index % colors.length];
}

export function createFile(room: Room, name: string) {
  const error = validateFileName(room, name);
  if (error) throw new Error(error);
  const file: RoomFile = {
    id: nanoid(10),
    name: name.trim(),
    language: detectLanguage(name.trim())!,
    content: ''
  };
  room.files.push(file);
  getRoomDoc(room.roomId).getText(`file:${file.id}`);
  return file;
}

export function renameFile(room: Room, fileId: string, name: string) {
  const file = room.files.find((item) => item.id === fileId);
  if (!file) throw new Error('Файл не найден');
  const error = validateFileName(room, name, fileId);
  if (error) throw new Error(error);
  file.name = name.trim();
  file.language = detectLanguage(file.name)!;
  return file;
}

export function deleteFile(room: Room, fileId: string) {
  if (room.files.length === 1) throw new Error('Нельзя удалить последний файл');
  const file = room.files.find((item) => item.id === fileId);
  if (!file) throw new Error('Файл не найден');
  room.files = room.files.filter((item) => item.id !== fileId);
  if (room.activeFileId === fileId) room.activeFileId = room.files[0].id;
}

export function selectFile(room: Room, fileId: string) {
  const file = room.files.find((item) => item.id === fileId);
  if (!file) throw new Error('Файл не найден');
  room.activeFileId = fileId;
  return file;
}
