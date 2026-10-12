import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../../database/client.js';
import { JobListQuerySchema, JobStatuses } from '../../models/job.js';
import { JobSearchService } from '../../services/job-search.service.js';
import { JobService } from '../../services/job.service.js';
import { JobAnalysisService } from '../../services/job-analysis.service.js';

export function jobsRoutes(db: Db, search: () => JobSearchService): Router {
  const r = Router();
  const svc = new JobService(db);

  r.get('/', (req, res) => {
    res.json(svc.list(JobListQuerySchema.parse(req.query)));
  });
  r.get('/sources', (_req, res) => {
    res.json(svc.sources());
  });
  r.post('/manual', async (req, res) => {
    res.status(201).json(await search().importManual(req.body));
  });
  r.get('/:id', (req, res) => {
    res.json(svc.get(Number(req.params.id)));
  });
  r.get('/:id/precheck', (req, res) => {
    res.json(new JobAnalysisService(db).precheck(Number(req.params.id)));
  });
  r.post('/:id/analyze', async (req, res) => {
    await new JobAnalysisService(db).analyze(Number(req.params.id));
    res.json(svc.get(Number(req.params.id)));
  });
  r.patch('/:id/status', (req, res) => {
    const { status } = z.object({ status: z.enum(JobStatuses) }).parse(req.body);
    svc.setStatus(Number(req.params.id), status);
    res.json(svc.get(Number(req.params.id)));
  });
  r.post('/:id/ungroup', (req, res) => {
    svc.ungroup(Number(req.params.id));
    res.json(svc.get(Number(req.params.id)));
  });
  return r;
}
