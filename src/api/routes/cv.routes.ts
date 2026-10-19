import { Router } from 'express';
import multer from 'multer';
import type { Db } from '../../database/client.js';
import { CvImportService, MAX_CV_BYTES } from '../../services/cv-import.service.js';
import { AppError } from '../../utils/errors.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_CV_BYTES, files: 1 } });

export function cvRoutes(db: Db): Router {
  const r = Router();
  const svc = new CvImportService(db);

  r.post('/import', upload.single('file'), async (req, res) => {
    if (!req.file) throw new AppError('No file uploaded (field "file")');
    const useLlm = req.body?.useLlm === 'true';
    res.status(201).json(await svc.import(req.file, { useLlm }));
  });
  r.get('/imports', (_req, res) => {
    res.json(svc.list());
  });
  r.get('/imports/:id', (req, res) => {
    const row = svc.get(Number(req.params.id));
    res.json({ id: row.id, originalFilename: row.originalFilename, status: row.status, method: row.extractionMethod, draft: row.extraction, createdAt: row.createdAt });
  });
  r.get('/imports/:id/verify', (req, res) => {
    res.json(svc.verifyIntegrity(Number(req.params.id)));
  });
  r.get('/imports/:id/original', (req, res) => {
    const f = svc.originalFile(Number(req.params.id));
    res.type(f.mimeType).download(f.absPath, f.filename);
  });
  return r;
}
