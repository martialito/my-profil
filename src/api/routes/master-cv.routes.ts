import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../../database/client.js';
import { MasterCvService } from '../../services/master-cv.service.js';

const SnapshotBody = z.object({ notes: z.string().max(500).optional(), sourceCvDocumentId: z.number().int().optional() });

export function masterCvRoutes(db: Db): Router {
  const r = Router();
  const svc = new MasterCvService(db);
  r.get('/', (_req, res) => {
    res.json({ latest: svc.latest() ?? null, versions: svc.list() });
  });
  r.get('/versions/:version', (req, res) => {
    res.json(svc.getVersion(Number(req.params.version)));
  });
  r.post('/snapshot', (req, res) => {
    const body = SnapshotBody.parse(req.body ?? {});
    res.status(201).json(svc.createSnapshot(body));
  });
  return r;
}
