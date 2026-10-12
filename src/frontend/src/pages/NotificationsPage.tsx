import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type AppNotification } from '../api';
import { Card, Notice } from '../components';

export function NotificationsPage({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [error, setError] = useState<string>();

  const load = () => api.notifications().then((r) => setItems(r.items)).catch((e: Error) => setError(e.message));
  useEffect(() => {
    api.notifications().then((r) => setItems(r.items)).catch((e: Error) => setError(e.message));
  }, []);
  const read = async (id: number) => {
    await api.readNotification(id);
    await load();
    onChange();
  };

  return (
    <>
      <div className="page-head">
        <h1>Notifications</h1>
        <button className="secondary" onClick={async () => { await api.readAllNotifications(); await load(); onChange(); }}>Mark all as read</button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <Card>
        {items.length === 0 && <p className="muted">No notifications.</p>}
        <ul className="notif-list">
          {items.map((n) => (
            <li key={n.id} className={`${n.readAt ? 'read' : ''} lvl-${n.level}`}>
              <div>
                <strong>{n.title}</strong>
                <div>{n.message}</div>
                <small className="muted">{new Date(n.createdAt).toLocaleString()}</small>
              </div>
              <div className="actions">
                {n.link && <Link to={n.link} onClick={() => !n.readAt && read(n.id)}>Open</Link>}
                {!n.readAt && <button className="secondary small" onClick={() => read(n.id)}>Mark read</button>}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <p className="muted small">Notifications appear here and on the dashboard. E-mail, Telegram and Discord channels are not implemented yet.</p>
    </>
  );
}
