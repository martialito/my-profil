import { Router } from 'express';
import type { Db } from '../../database/client.js';
import { NotificationService } from '../../notifications/notification.service.js';

export function notificationsRoutes(db: Db): Router {
  const r = Router();
  const svc = new NotificationService(db);
  r.get('/', (req, res) => {
    res.json({ items: svc.list({ unreadOnly: req.query.unread === 'true' }), counts: svc.counts() });
  });
  r.get('/counts', (_req, res) => {
    res.json(svc.counts());
  });
  r.post('/read-all', (_req, res) => {
    svc.markAllRead();
    res.json(svc.counts());
  });
  r.post('/:id/read', (req, res) => {
    svc.markRead(Number(req.params.id));
    res.json(svc.counts());
  });
  return r;
}
