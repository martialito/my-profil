import { Router } from 'express';
import { z } from 'zod';
import type { JobSearchService } from '../../services/job-search.service.js';
import { AppError } from '../../utils/errors.js';

const AddBoard = z.object({
  provider: z.enum(['greenhouse', 'lever']).optional(),
  token: z.string().trim().optional(),
  url: z.url().optional(),
  companyName: z.string().trim().max(120).optional(),
});

let running = false;

export function searchRoutes(search: () => JobSearchService): Router {
  const r = Router();

  r.post('/run', async (_req, res) => {
    if (running) throw new AppError('A search is already running', 409, 'CONFLICT');
    running = true;
    try {
      res.json(await search().run('manual'));
    } finally {
      running = false;
    }
  });
  r.get('/runs', (_req, res) => {
    res.json(search().runs());
  });
  r.get('/queries', (_req, res) => {
    res.json(search().queries());
  });
  r.get('/boards', (_req, res) => {
    res.json(search().listBoards());
  });
  r.post('/boards', async (req, res) => {
    res.status(201).json(await search().addBoard(AddBoard.parse(req.body)));
  });
  r.patch('/boards/:id', (req, res) => {
    const patch = z.object({ enabled: z.boolean().optional(), companyName: z.string().trim().min(1).max(120).optional() }).parse(req.body);
    res.json(search().updateBoard(Number(req.params.id), patch));
  });
  r.delete('/boards/:id', (req, res) => {
    search().removeBoard(Number(req.params.id));
    res.status(204).end();
  });
  return r;
}
