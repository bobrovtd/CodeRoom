export type FileLanguage = 'python' | 'plaintext';

export type RoomFile = {
  id: string;
  name: string;
  language: FileLanguage;
  content: string;
};

export type User = {
  clientId: string;
  name: string;
  color: string;
};

export type RunResult = {
  status: 'idle' | 'running' | 'success' | 'error';
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export type RoomState = {
  roomId: string;
  files: RoomFile[];
  activeFileId: string;
  users: User[];
  lastRun: RunResult;
};

export type ServerMessage =
  | { type: 'roomState'; room: RoomState }
  | { type: 'usersUpdated'; users: User[] }
  | { type: 'filesUpdated'; files: RoomFile[] }
  | { type: 'activeFileUpdated'; activeFileId: string }
  | { type: 'runStarted'; result: RunResult }
  | { type: 'runFinished'; result: RunResult }
  | { type: 'error'; message: string };
