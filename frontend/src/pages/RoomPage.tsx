import Editor, { OnMount } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import { API_URL, WS_URL } from '../config';
import { ThemeToggle, useTheme } from '../theme';
import type { RoomFile, RoomState, RunResult, ServerMessage } from '../types';

const emptyRun: RunResult = {
  status: 'idle',
  stdout: '',
  stderr: '',
  exitCode: null
};

function getClientId() {
  const existing = sessionStorage.getItem('clientId');
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem('clientId', created);
  return created;
}

function getUserColor() {
  const existing = sessionStorage.getItem('userColor');
  if (existing) return existing;
  const colors = ['#f97316', '#22c55e', '#38bdf8', '#a78bfa', '#f43f5e', '#eab308', '#14b8a6'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  sessionStorage.setItem('userColor', color);
  return color;
}

export function RoomPage() {
  const { roomId = '' } = useParams();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const clientId = useMemo(getClientId, []);
  const userColor = useMemo(getUserColor, []);
  const [nameInput, setNameInput] = useState(localStorage.getItem('displayName') || '');
  const [joinedName, setJoinedName] = useState('');
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState('');
  const [socketReady, setSocketReady] = useState(false);
  const [runResult, setRunResult] = useState<RunResult>(emptyRun);
  const [editorMounted, setEditorMounted] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof monaco | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const runCodeRef = useRef<() => void>(() => {});
  const remoteSelectionStyleRef = useRef<HTMLStyleElement | null>(null);

  const activeFile = room?.files.find((file) => file.id === room.activeFileId) || null;

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/rooms/${roomId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Комната не найдена');
        return (await response.json()) as RoomState;
      })
      .then((data) => {
        if (!cancelled) {
          setRoom(data);
          setRunResult(data.lastRun);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Ошибка загрузки комнаты');
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  useEffect(() => {
    if (!joinedName || !roomId) return;

    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(`${WS_URL}/yjs`, roomId, ydoc, { connect: true });
    ydocRef.current = ydoc;
    providerRef.current = provider;
    provider.awareness.setLocalStateField('user', {
      name: joinedName,
      color: userColor
    });

    const styleElement = document.createElement('style');
    styleElement.dataset.roomRemoteSelections = roomId;
    document.head.append(styleElement);
    remoteSelectionStyleRef.current = styleElement;

    const updateRemoteSelectionStyles = () => {
      const rules: string[] = [];
      provider.awareness.getStates().forEach((state, awarenessClientId) => {
        if (awarenessClientId === ydoc.clientID) return;
        const user = state.user as { color?: unknown } | undefined;
        const color = typeof user?.color === 'string' && CSS.supports('color', user.color) ? user.color : '#4f8cff';
        rules.push(`
.yRemoteSelection-${awarenessClientId} {
  background-color: color-mix(in srgb, ${color} 28%, transparent) !important;
}

.yRemoteSelectionHead-${awarenessClientId} {
  border-left-color: ${color} !important;
  border-top-color: ${color} !important;
  border-bottom-color: ${color} !important;
}`);
      });
      styleElement.textContent = rules.join('\n');
    };

    provider.awareness.on('change', updateRemoteSelectionStyles);
    updateRemoteSelectionStyles();

    const ws = new WebSocket(`${WS_URL}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setSocketReady(true);
      ws.send(JSON.stringify({ type: 'joinRoom', roomId, clientId, name: joinedName, color: userColor }));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === 'roomState') {
        setRoom(message.room);
        setRunResult(message.room.lastRun);
      }
      if (message.type === 'usersUpdated') setRoom((prev) => (prev ? { ...prev, users: message.users } : prev));
      if (message.type === 'filesUpdated') setRoom((prev) => (prev ? { ...prev, files: message.files } : prev));
      if (message.type === 'activeFileUpdated') setRoom((prev) => (prev ? { ...prev, activeFileId: message.activeFileId } : prev));
      if (message.type === 'runStarted' || message.type === 'runFinished') setRunResult(message.result);
      if (message.type === 'error') setError(message.message);
    };

    ws.onclose = () => {
      setSocketReady(false);
    };

    ws.onerror = () => {
      setError('Ошибка WebSocket подключения');
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'leaveRoom', roomId, clientId }));
      }
      ws.close();
      provider.awareness.off('change', updateRemoteSelectionStyles);
      bindingRef.current?.destroy();
      modelRef.current?.dispose();
      styleElement.remove();
      provider.destroy();
      ydoc.destroy();
      wsRef.current = null;
      ydocRef.current = null;
      providerRef.current = null;
      bindingRef.current = null;
      modelRef.current = null;
      remoteSelectionStyleRef.current = null;
    };
  }, [joinedName, roomId, clientId, userColor]);

  useEffect(() => {
    if (!activeFile || !editorMounted || !editorRef.current || !monacoRef.current || !ydocRef.current || !providerRef.current) return;

    bindingRef.current?.destroy();
    modelRef.current?.dispose();

    const text = ydocRef.current.getText(`file:${activeFile.id}`);
    const model = monacoRef.current.editor.createModel(text.toString(), activeFile.language);
    editorRef.current.setModel(model);
    bindingRef.current = new MonacoBinding(text, model, new Set([editorRef.current]), providerRef.current.awareness);
    modelRef.current = model;
  }, [activeFile?.id, activeFile?.language, editorMounted]);

  useEffect(() => {
    monacoRef.current?.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'light');
  }, [theme]);

  const send = (payload: Record<string, unknown>) => {
    setError('');
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setError('WebSocket не подключен');
      return;
    }
    wsRef.current.send(JSON.stringify({ ...payload, roomId }));
  };

  function joinRoom(event: FormEvent) {
    event.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setError('Введите имя');
      return;
    }
    localStorage.setItem('displayName', trimmed);
    setJoinedName(trimmed);
  }

  function createFile() {
    const name = prompt('Имя файла (.py или .txt)');
    if (name) send({ type: 'createFile', name });
  }

  function renameFile(file: RoomFile) {
    const name = prompt('Новое имя файла', file.name);
    if (name && name !== file.name) send({ type: 'renameFile', fileId: file.id, name });
  }

  function deleteFile(file: RoomFile) {
    if (confirm(`Удалить ${file.name}?`)) send({ type: 'deleteFile', fileId: file.id });
  }

  const runCode = useCallback(() => {
    if (!activeFile || runResult.status === 'running') return;
    send({ type: 'runCode', fileId: activeFile.id });
  }, [activeFile, runResult.status]);

  function stopCode() {
    if (runResult.status !== 'running') return;
    send({ type: 'stopCode' });
  }

  useEffect(() => {
    runCodeRef.current = runCode;
  }, [runCode]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey || event.key !== 'Enter') return;
      event.preventDefault();
      runCodeRef.current();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleEditorMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor;
    monacoRef.current = monacoInstance;
    monacoInstance.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'light');
    editor.addAction({
      id: 'run-code',
      label: 'Run code',
      keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter],
      run: () => runCodeRef.current()
    });
    setEditorMounted(true);
  };

  if (!room && error) {
    return (
      <main className="centerScreen">
        <div className="notFoundPanel">
          <div className="emptyIcon">!</div>
          <div className="errorBox">{error}</div>
          <button className="primaryButton" type="button" onClick={() => navigate('/')}>
            На главную
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="roomPage">
      {!joinedName && (
        <div className="modalBackdrop">
          <form className="nameDialog" onSubmit={joinRoom}>
            <div className="dialogIcon">CC</div>
            <h2>Вход в комнату</h2>
            <p className="dialogText">Введите имя, которое увидят другие участники.</p>
            <input value={nameInput} onChange={(event) => setNameInput(event.target.value)} placeholder="Ваше имя" autoFocus />
            <button className="primaryButton" type="submit">
              Войти
            </button>
          </form>
        </div>
      )}

      <header className="topBar">
        <div className="roomIdentity">
          <div className="brandMark small">CC</div>
          <div>
            <span className="muted">Комната</span>
            <strong>{roomId}</strong>
          </div>
        </div>
        <div className="topBarActions">
          <button className="ghostButton" onClick={() => navigator.clipboard.writeText(window.location.href)}>
            Скопировать ссылку
          </button>
          <ThemeToggle />
          <div className={`connection ${socketReady ? 'online' : 'offline'}`}>
            <span className="connectionDot" />
            {socketReady ? 'Подключено' : 'Отключено'}
          </div>
        </div>
      </header>

      {error && (
        <div className="toast">
          <span>{error}</span>
          <button onClick={() => setError('')}>x</button>
        </div>
      )}

      <section className="workspace">
        <aside className="sidebar">
          <div className="panelHeader">
            <div>
              <span className="sectionLabel">Workspace</span>
              <h2>Файлы</h2>
            </div>
            <button className="iconTextButton" onClick={createFile}>
              + Файл
            </button>
          </div>
          <div className="fileList">
            {room?.files.map((file) => (
              <div className={`fileItem ${file.id === room.activeFileId ? 'active' : ''}`} key={file.id}>
                <button className="fileName" onClick={() => send({ type: 'selectFile', fileId: file.id })}>
                  <span className="fileIcon">{file.language === 'python' ? 'PY' : 'TXT'}</span>
                  <span>{file.name}</span>
                </button>
                <div className="fileActions">
                  <button className="smallButton" onClick={() => renameFile(file)} title="Переименовать">
                    Rename
                  </button>
                  <button className="smallButton danger" onClick={() => deleteFile(file)} title="Удалить">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="editorPane">
          <div className="editorTitle">
            <div className="editorTitleMain">
              <span className="editorDot" />
              <span>{activeFile?.name || 'Файл не выбран'}</span>
            </div>
            <span className="shortcutHint">Ctrl Enter</span>
          </div>
          <Editor
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            options={{ minimap: { enabled: false }, fontSize: 14, tabSize: 4, automaticLayout: true }}
            onMount={handleEditorMount}
          />
        </section>

        <aside className="outputPane">
          <section className="sidePanel">
            <div className="panelHeader">
              <div>
                <span className="sectionLabel">Presence</span>
                <h2>Участники</h2>
              </div>
              <span className="countBadge">{room?.users.length || 0}</span>
            </div>
            <div className="users">
              {room?.users.length ? (
                room.users.map((user) => (
                  <span className="userPill" key={user.clientId} style={{ borderColor: user.color }}>
                    <span className="dot" style={{ background: user.color }} />
                    {user.name}
                  </span>
                ))
              ) : (
                <div className="emptyState">Пока никого нет в комнате.</div>
              )}
            </div>
          </section>

          <section className="sidePanel runPanel">
            <div className="panelHeader">
              <div>
                <span className="sectionLabel">Python runner</span>
                <h2>Запуск</h2>
              </div>
              <button
                className={`primaryButton runButton ${runResult.status === 'running' ? 'stopButton' : ''}`}
                onClick={runResult.status === 'running' ? stopCode : runCode}
                disabled={!activeFile}
              >
                {runResult.status === 'running' ? 'Stop' : 'Run'}
              </button>
            </div>
            <div className={`status status-${runResult.status}`}>
              {runResult.status === 'idle' && 'Не запускалось'}
              {runResult.status === 'running' && 'Выполняется'}
              {runResult.status === 'success' && 'Успешно завершено'}
              {runResult.status === 'error' && 'Ошибка'}
              {runResult.status === 'stopped' && 'Остановлено'}
            </div>
            <pre className="output">{runResult.stdout || runResult.stderr ? `${runResult.stdout}${runResult.stderr}` : 'Вывод появится здесь.'}</pre>
            <div className="exitCode">exitCode: {runResult.exitCode ?? 'null'}</div>
          </section>
        </aside>
      </section>
    </main>
  );
}
