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
        <div className="homeHero">
          <p className="eyebrow">Collaborative Python workspace</p>
          <h1>CodeRoom</h1>
          <div className="homeActions">
            <button className="primaryButton largeButton" onClick={createRoom} disabled={creating}>
              {creating ? 'Создание...' : 'Создать комнату'}
            </button>
          </div>
          {error && <div className="errorBox">{error}</div>}
        </div>
        <div className="homePreview" aria-hidden="true">
          <div className="previewTop">
            <span />
            <span />
            <span />
          </div>
          <div className="previewBody">
            <div className="previewSidebar">
              <span className="previewFile active" />
              <span className="previewFile" />
              <span className="previewFile short" />
            </div>
            <div className="previewEditor">
              <span />
              <span />
              <span className="wide" />
              <span />
              <span className="accent" />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
