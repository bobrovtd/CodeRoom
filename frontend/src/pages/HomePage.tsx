import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config';
import { ThemeToggle } from '../theme';

export function HomePage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  async function createRoom() {
    setCreating(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/rooms`, { method: 'POST' });
      if (!response.ok) throw new Error('Не удалось создать комнату');
      const data = (await response.json()) as { roomId: string };
      navigate(`/room/${data.roomId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="home">
      <div className="floatingActions">
        <ThemeToggle />
      </div>
      <section className="homePanel">
        <div className="brandMark">CC</div>
        <p className="eyebrow">Python classroom</p>
        <h1>Collab Code Platform</h1>
        <p className="homeText">Совместное написание и запуск Python-кода в учебной комнате.</p>
        <button className="primaryButton" onClick={createRoom} disabled={creating}>
          {creating ? 'Создание...' : 'Создать комнату'}
        </button>
        {error && <div className="errorBox">{error}</div>}
      </section>
    </main>
  );
}
