import Editor, { BeforeMount, OnMount } from '@monaco-editor/react';
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

const editorFontSizeStorageKey = 'editorFontSize';
const minEditorFontSize = 12;
const maxEditorFontSize = 22;

function clampEditorFontSize(size: number) {
  return Math.min(maxEditorFontSize, Math.max(minEditorFontSize, size));
}

function getStoredEditorFontSize() {
  const saved = Number(localStorage.getItem(editorFontSizeStorageKey));
  return Number.isFinite(saved) ? clampEditorFontSize(saved) : 14;
}

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

function getEditorThemeName(theme: 'dark' | 'light') {
  return theme === 'dark' ? 'coderoom-dark' : 'coderoom-light';
}

function defineEditorThemes(monacoInstance: typeof monaco) {
  monacoInstance.editor.defineTheme('coderoom-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '7f8a9e', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'a78bfa' },
      { token: 'number', foreground: '22d3ee' },
      { token: 'string', foreground: '86efac' },
      { token: 'type', foreground: '93c5fd' },
      { token: 'function', foreground: 'f8fafc' },
      { token: 'delimiter', foreground: '94a3b8' }
    ],
    colors: {
      'editor.background': '#101116',
      'editor.foreground': '#e6edf7',
      'editorLineNumber.foreground': '#4b5568',
      'editorLineNumber.activeForeground': '#c4b5fd',
      'editorCursor.foreground': '#22d3ee',
      'editor.selectionBackground': '#7c5cff55',
      'editor.inactiveSelectionBackground': '#7c5cff2f',
      'editor.lineHighlightBackground': '#ffffff08',
      'editor.lineHighlightBorder': '#00000000',
      'editorIndentGuide.background1': '#ffffff12',
      'editorIndentGuide.activeBackground1': '#22d3ee66',
      'editorBracketMatch.background': '#22d3ee1f',
      'editorBracketMatch.border': '#22d3ee88',
      'scrollbarSlider.background': '#ffffff20',
      'scrollbarSlider.hoverBackground': '#ffffff2f',
      'scrollbarSlider.activeBackground': '#7c5cff80',
      'editorWidget.background': '#171923',
      'editorWidget.border': '#ffffff14',
      'editorSuggestWidget.background': '#171923',
      'editorSuggestWidget.border': '#ffffff14'
    }
  });

  monacoInstance.editor.defineTheme('coderoom-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '667085', fontStyle: 'italic' },
      { token: 'keyword', foreground: '6941c6' },
      { token: 'number', foreground: '0891b2' },
      { token: 'string', foreground: '047857' },
      { token: 'type', foreground: '2563eb' },
      { token: 'function', foreground: '0f172a' },
      { token: 'delimiter', foreground: '64748b' }
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#172033',
      'editorLineNumber.foreground': '#a0aec0',
      'editorLineNumber.activeForeground': '#6250f6',
      'editorCursor.foreground': '#0891b2',
      'editor.selectionBackground': '#6250f630',
      'editor.inactiveSelectionBackground': '#6250f61f',
      'editor.lineHighlightBackground': '#6250f608',
      'editor.lineHighlightBorder': '#00000000',
      'editorIndentGuide.background1': '#0f172a14',
      'editorIndentGuide.activeBackground1': '#0891b266',
      'editorBracketMatch.background': '#0891b217',
      'editorBracketMatch.border': '#0891b277',
      'scrollbarSlider.background': '#0f172a20',
      'scrollbarSlider.hoverBackground': '#0f172a30',
      'scrollbarSlider.activeBackground': '#6250f670',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#d8e0eb',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.border': '#d8e0eb'
    }
  });
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
  const [initialSyncComplete, setInitialSyncComplete] = useState(false);
  const [editorModelReady, setEditorModelReady] = useState(false);
  const [editorModelFileId, setEditorModelFileId] = useState<string | null>(null);
  const [firstEditorLoadComplete, setFirstEditorLoadComplete] = useState(false);
  const [editorFontSize, setEditorFontSize] = useState(getStoredEditorFontSize);

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
  const activeModelReady = Boolean(activeFile && editorModelReady && editorModelFileId === activeFile.id);
  const editorReady = Boolean(activeFile && initialSyncComplete && activeModelReady);
  const runReady = Boolean(activeFile && activeModelReady && socketReady);
  const showEditorLoading = Boolean(joinedName && activeFile && !firstEditorLoadComplete && (!initialSyncComplete || !editorModelReady));

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
    setInitialSyncComplete(provider.synced);
    setEditorModelReady(false);
    setEditorModelFileId(null);
    setFirstEditorLoadComplete(false);
    provider.awareness.setLocalStateField('user', {
      name: joinedName,
      color: userColor
    });

    const handleProviderSync = (isSynced: boolean) => {
      if (isSynced) setInitialSyncComplete(true);
    };

    provider.on('sync', handleProviderSync);

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

    let closedByCleanup = false;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;

    const connectApiSocket = () => {
      const ws = new WebSocket(`${WS_URL}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempt = 0;
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
        if (wsRef.current === ws) {
          wsRef.current = null;
          setSocketReady(false);
        }

        if (closedByCleanup) return;
        const delay = Math.min(4000, 500 * 2 ** reconnectAttempt);
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(connectApiSocket, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connectApiSocket();

    return () => {
      closedByCleanup = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'leaveRoom', roomId, clientId }));
      }
      ws?.close();
      provider.off('sync', handleProviderSync);
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
      setInitialSyncComplete(false);
      setEditorModelReady(false);
      setEditorModelFileId(null);
      setFirstEditorLoadComplete(false);
    };
  }, [joinedName, roomId, clientId, userColor]);

  useEffect(() => {
    if (!activeFile || !editorMounted || !initialSyncComplete || !editorRef.current || !monacoRef.current || !ydocRef.current || !providerRef.current) {
      setEditorModelReady(false);
      setEditorModelFileId(null);
      return;
    }

    setEditorModelReady(false);
    setEditorModelFileId(null);
    bindingRef.current?.destroy();
    modelRef.current?.dispose();

    const text = ydocRef.current.getText(`file:${activeFile.id}`);
    const model = monacoRef.current.editor.createModel(text.toString(), activeFile.language);
    editorRef.current.setModel(model);
    bindingRef.current = new MonacoBinding(text, model, new Set([editorRef.current]), providerRef.current.awareness);
    modelRef.current = model;
    setEditorModelFileId(activeFile.id);
    setEditorModelReady(true);
    setFirstEditorLoadComplete(true);
  }, [activeFile?.id, activeFile?.language, editorMounted, initialSyncComplete]);

  useEffect(() => {
    if (!monacoRef.current) return;
    defineEditorThemes(monacoRef.current);
    monacoRef.current.editor.setTheme(getEditorThemeName(theme));
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(editorFontSizeStorageKey, String(editorFontSize));
    editorRef.current?.updateOptions({
      fontSize: editorFontSize,
      lineHeight: Math.round(editorFontSize * 1.65)
    });
  }, [editorFontSize]);

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
    if (!activeFile || !runReady || runResult.status === 'running') return;
    send({ type: 'runCode', fileId: activeFile.id, content: modelRef.current?.getValue() ?? '' });
  }, [activeFile, runReady, runResult.status]);

  function stopCode() {
    if (runResult.status !== 'running') return;
    send({ type: 'stopCode' });
  }

  function changeEditorFontSize(delta: number) {
    setEditorFontSize((current) => clampEditorFontSize(current + delta));
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

  const handleEditorBeforeMount: BeforeMount = (monacoInstance) => {
    defineEditorThemes(monacoInstance);
  };

  const handleEditorMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor;
    monacoRef.current = monacoInstance;
    defineEditorThemes(monacoInstance);
    monacoInstance.editor.setTheme(getEditorThemeName(theme));
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
              <span className="sectionLabel">Файлы</span>
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
            <div className="editorTools">
              <div className="fontSizeControl" aria-label="Размер шрифта редактора">
                <button type="button" onClick={() => changeEditorFontSize(-1)} disabled={editorFontSize <= minEditorFontSize}>
                  A-
                </button>
                <span>{editorFontSize}</span>
                <button type="button" onClick={() => changeEditorFontSize(1)} disabled={editorFontSize >= maxEditorFontSize}>
                  A+
                </button>
              </div>
              <span className="shortcutHint">Ctrl Enter</span>
            </div>
          </div>
          <div className="editorShell">
            <Editor
              theme={getEditorThemeName(theme)}
              beforeMount={handleEditorBeforeMount}
              options={{
                readOnly: !editorReady,
                minimap: { enabled: false },
                fontSize: editorFontSize,
                lineHeight: Math.round(editorFontSize * 1.65),
                fontFamily: '"Cascadia Code", "SF Mono", Consolas, "Liberation Mono", monospace',
                fontLigatures: true,
                tabSize: 4,
                automaticLayout: true,
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                cursorBlinking: 'smooth',
                cursorSmoothCaretAnimation: 'on',
                renderLineHighlight: 'all',
                overviewRulerBorder: false,
                padding: { top: 18, bottom: 18 },
                bracketPairColorization: { enabled: true },
                guides: { bracketPairs: true, indentation: true },
                scrollbar: {
                  verticalScrollbarSize: 10,
                  horizontalScrollbarSize: 10,
                  useShadows: false
                }
              }}
              onMount={handleEditorMount}
            />
            {showEditorLoading && (
              <div className="editorLoadingOverlay" aria-live="polite">
                <div className="editorSpinner" />
                <span>Подключение редактора</span>
              </div>
            )}
          </div>
        </section>

        <aside className="outputPane">
          <section className="sidePanel">
            <div className="panelHeader">
              <div>
                <span className="sectionLabel">Участники</span>
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
                <span className="sectionLabel">Вывод</span>
              </div>
              <button
                className={`primaryButton runButton ${runResult.status === 'running' ? 'stopButton' : ''}`}
                onClick={runResult.status === 'running' ? stopCode : runCode}
                disabled={runResult.status !== 'running' && !runReady}
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
