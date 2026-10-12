import { Router } from 'express';
import type { Db } from '../../database/client.js';
import { profileCompleteness } from '../../models/profile.js';
import { ProfileService } from '../../services/profile.service.js';

export function profileRoutes(db: Db): Router {
  const r = Router();
  const svc = new ProfileService(db);
  r.get('/', (_req, res) => {
    const profile = svc.get();
    res.json({ profile, completeness: profileCompleteness(profile) });
  });
  r.put('/', (req, res) => {
    const profile = svc.save(req.body);
    res.json({ profile, completeness: profileCompleteness(profile) });
  });
  return r;
}
