import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../../database/client.js';
import { ApplicationStatuses } from '../../models/statuses.js';
import { ApplicationService } from '../../services/application.service.js';

const Transition = z.object({
  to: z.enum(ApplicationStatuses),
  note: z.string().trim().max(2000).optional(),
  applicationDate: z.string().optional(),
  confirmationText: z.string().trim().max(5000).optional(),
  confirmationUrl: z.url().optional(),
});
const Patch = z.object({
  notes: z.string().max(10_000).nullable().optional(),
  followUpDate: z.string().nullable().optional(),
});

export function applicationsRoutes(db: Db): Router {
  const r = Router();
  const svc = new ApplicationService(db);
  r.get('/', (req, res) => {
    const q = z.object({ status: z.string().optional(), q: z.string().optional(), active: z.enum(['true', 'false']).optional() }).parse(req.query);
    res.json(svc.list({ status: q.status, q: q.q, active: q.active === 'true' }));
  });
  r.get('/by-job/:jobId', (req, res) => {
    const found = svc.list().find((a) => a.jobId === Number(req.params.jobId));
    res.json(found ? svc.get(found.id) : null);
  });
  r.post('/for-job/:jobId', (req, res) => {
    res.status(201).json(svc.get(svc.forJob(Number(req.params.jobId)).id));
  });
  r.get('/:id', (req, res) => {
    res.json(svc.get(Number(req.params.id)));
  });
  r.post('/:id/transition', (req, res) => {
    res.json(svc.transition(Number(req.params.id), Transition.parse(req.body)));
  });
  r.patch('/:id', (req, res) => {
    res.json(svc.update(Number(req.params.id), Patch.parse(req.body)));
  });
  return r;
}
