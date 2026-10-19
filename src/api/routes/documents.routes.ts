import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../../database/client.js';
import { DocumentsService } from '../../services/documents.service.js';
import { AppError } from '../../utils/errors.js';

const GenerateBody = z.object({
  what: z.enum(['all', 'resume', 'cover-letter']).default('all'),
  guidance: z.string().trim().max(1000).optional(),
  force: z.boolean().optional(),
});

let running = false;

/** Routes mounted under /api/jobs/:id/… and /api/documents/… */
export function jobDocumentsRoutes(db: Db): Router {
  const r = Router({ mergeParams: true });
  const svc = new DocumentsService(db);
  r.get('/', (req, res) => {
    res.json(svc.latest(Number((req.params as { id: string }).id)));
  });
  r.post('/', async (req, res) => {
    const id = Number((req.params as { id: string }).id);
    const body = GenerateBody.parse(req.body ?? {});
    const opts = { guidance: body.guidance, force: body.force };
    if (body.what === 'resume') await svc.generateResume(id, opts);
    else if (body.what === 'cover-letter') await svc.generateCoverLetter(id, opts);
    else await svc.generateForJob(id, opts);
    res.status(201).json(svc.latest(id));
  });
  r.put('/cover-letter', async (req, res) => {
    const id = Number((req.params as { id: string }).id);
    const { text } = z.object({ text: z.string().max(20_000) }).parse(req.body);
    await svc.saveEditedLetter(id, text);
    res.json(svc.latest(id));
  });
  return r;
}

export function documentsRoutes(db: Db): Router {
  const r = Router();
  const svc = new DocumentsService(db);
  r.post('/generate-pending', async (req, res) => {
    const { limit } = z.object({ limit: z.number().int().min(1).max(100).optional() }).parse(req.body ?? {});
    if (running) throw new AppError('A generation is already running', 409, 'CONFLICT');
    running = true;
    try {
      res.json(await svc.generatePending({ limit }));
    } finally {
      running = false;
    }
  });
  r.get('/:kind/:id/:format', (req, res) => {
    const kind = z.enum(['resume', 'cover-letter']).parse(req.params.kind);
    const format = z.enum(['pdf', 'docx', 'txt']).parse(req.params.format);
    const f = svc.file(kind, Number(req.params.id), format);
    // dotfiles: 'allow' because the generated directory may live under a dot-folder (e.g. tests/.tmp).
    res.download(f.absPath, f.filename, { dotfiles: 'allow' });
  });
  return r;
}
