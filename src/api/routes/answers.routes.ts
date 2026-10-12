import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../../database/client.js';
import { AnswerBankService, AnswerInputSchema } from '../../services/answer-bank.service.js';

export function answersRoutes(db: Db): Router {
  const r = Router();
  const svc = new AnswerBankService(db);
  r.get('/', (_req, res) => {
    res.json(svc.list());
  });
  r.post('/', (req, res) => {
    res.status(201).json(svc.create(AnswerInputSchema.parse(req.body)));
  });
  r.put('/:id', (req, res) => {
    res.json(svc.update(Number(req.params.id), AnswerInputSchema.parse(req.body)));
  });
  r.delete('/:id', (req, res) => {
    svc.remove(Number(req.params.id));
    res.status(204).end();
  });
  r.post('/match', (req, res) => {
    const { question } = z.object({ question: z.string().min(3).max(500) }).parse(req.body);
    res.json(svc.match(question));
  });
  r.post('/suggest', async (req, res) => {
    const b = z.object({ question: z.string().min(3).max(500), fieldType: z.string().default('text'), options: z.array(z.string()).default([]) }).parse(req.body);
    res.json(await svc.suggestWithLlm(b.question, b.fieldType, b.options));
  });
  return r;
}
