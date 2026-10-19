import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { z } from 'zod';
import { env, paths } from '../../config/env.js';
import type { Db } from '../../database/client.js';
import { ApplicationModes } from '../../models/common.js';
import { ApplicationEngineService } from '../../services/application-engine.service.js';
import { AppError } from '../../utils/errors.js';

const Simulate = z.object({
  answers: z.record(z.string(), z.string().max(10_000)).optional(),
  saveToBank: z.array(z.string()).optional(),
});

let running = false;
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (running) throw new AppError('A browser simulation is already running', 409, 'CONFLICT');
  running = true;
  try {
    return await fn();
  } finally {
    running = false;
  }
}

/** Mounted on /api/applications/:id/… */
export function applicationEngineRoutes(db: Db): Router {
  const r = Router({ mergeParams: true });
  const svc = new ApplicationEngineService(db);
  const id = (req: { params: unknown }) => Number((req.params as { id: string }).id);
  r.get('/check', (req, res) => {
    res.json(svc.check(id(req)));
  });
  r.put('/mode', (req, res) => {
    const { mode } = z.object({ mode: z.enum(ApplicationModes).nullable() }).parse(req.body);
    svc.setMode(id(req), mode);
    res.json({ mode: svc.effectiveMode(id(req)) });
  });
  r.post('/simulate', async (req, res) => {
    const body = Simulate.parse(req.body ?? {});
    res.json(await exclusive(() => svc.simulate(id(req), body)));
  });
  r.get('/simulation-screenshot/:file', (req, res) => {
    res.sendFile(svc.screenshot(id(req), req.params.file as string), { dotfiles: 'allow' });
  });
  r.post('/submit', async (req, res) => {
    // Real submission: requires your explicit confirmation and the digest of the simulation you reviewed.
    const body = z
      .object({ confirm: z.literal(true), expectedDigest: z.string().regex(/^[0-9a-f]{16}$/), answers: z.record(z.string(), z.string().max(10_000)).optional() })
      .parse(req.body ?? {});
    res.json(await exclusive(() => svc.submit(id(req), { expectedDigest: body.expectedDigest, answers: body.answers })));
  });
  return r;
}

const DEMO_FORM = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../browser/demo-form.html');
const demoFormPath = () => (fs.existsSync(DEMO_FORM) ? DEMO_FORM : path.resolve('src/browser/demo-form.html'));

export function demoRoutes(db: Db): { page: Router; api: Router } {
  const page = Router();
  page.get('/application-form', (_req, res) => {
    res.sendFile(demoFormPath());
  });
  const api = Router();
  api.post('/simulate', async (req, res) => {
    const { answers } = Simulate.parse(req.body ?? {});
    const { HOST, PORT } = env();
    res.json(await exclusive(() => new ApplicationEngineService(db).simulateDemo(`http://${HOST}:${PORT}/demo/application-form`, answers)));
  });
  api.get('/simulation.png', (_req, res) => {
    res.sendFile(path.join(paths.generated(), 'demo', 'simulation.png'), { dotfiles: 'allow' });
  });
  return { page, api };
}
