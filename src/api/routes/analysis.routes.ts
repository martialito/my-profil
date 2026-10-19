import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../../database/client.js';
import { JobAnalysisService } from '../../services/job-analysis.service.js';
import { AppError } from '../../utils/errors.js';

let running = false;

export function analysisRoutes(db: Db): Router {
  const r = Router();
  r.post('/run', async (req, res) => {
    const body = z.object({ limit: z.number().int().min(1).max(200).optional(), jobIds: z.array(z.number().int()).optional() }).parse(req.body ?? {});
    if (running) throw new AppError('An analysis is already running', 409, 'CONFLICT');
    running = true;
    try {
      res.json(await new JobAnalysisService(db).analyzePending(body));
    } finally {
      running = false;
    }
  });
  return r;
}
