import fs from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import type { Db } from '../database/client.js';
import { LlmError } from '../llm/types.js';
import { SourceError } from '../job-search/http.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { cvRoutes } from './routes/cv.routes.js';
import { dashboardRoutes } from './routes/dashboard.routes.js';
import { masterCvRoutes } from './routes/master-cv.routes.js';
import { profileRoutes } from './routes/profile.routes.js';
import { settingsRoutes } from './routes/settings.routes.js';
import { jobsRoutes } from './routes/jobs.routes.js';
import { searchRoutes } from './routes/search.routes.js';
import { analysisRoutes } from './routes/analysis.routes.js';
import { JobSearchService, type JobSearchOptions } from '../services/job-search.service.js';

export function createApp(db: Db, opts: { staticDir?: string; jobSearch?: JobSearchOptions } = {}): express.Express {
  const app = express();
  const search = () => new JobSearchService(db, opts.jobSearch);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/dashboard', dashboardRoutes(db));
  app.use('/api/profile', profileRoutes(db));
  app.use('/api/settings', settingsRoutes(db));
  app.use('/api/master-cv', masterCvRoutes(db));
  app.use('/api/cv', cvRoutes(db));
  app.use('/api/jobs', jobsRoutes(db, search));
  app.use('/api/search', searchRoutes(search));
  app.use('/api/analysis', analysisRoutes(db));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API route' } });
  });

  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(opts.staticDir!, 'index.html'));
    });
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    if (err instanceof ZodError) {
      res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.issues } });
      return;
    }
    if (err instanceof multer.MulterError) {
      res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof SourceError) {
      res.status(502).json({ error: { code: 'SOURCE_ERROR', message: err.message } });
      return;
    }
    if (err instanceof LlmError) {
      res.status(err.kind === 'not_configured' ? 400 : 502).json({ error: { code: `LLM_${err.kind.toUpperCase()}`, message: err.message } });
      return;
    }
    logger.error('Unhandled error', { message: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  };
  app.use(onError);
  return app;
}
