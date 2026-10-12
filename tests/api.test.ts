import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import { sampleDocx } from './fixtures/sample-cv.js';
import { sampleProfile, testDb } from './helpers.js';

describe('HTTP API', () => {
  const app = createApp(testDb());

  it('health + dashboard with real (zero) counts', async () => {
    expect((await request(app).get('/api/health')).body).toEqual({ ok: true });
    const d = await request(app).get('/api/dashboard');
    expect(d.status).toBe(200);
    expect(d.body.stats.totalJobs).toBe(0);
    expect(d.body.stats.applicationsSubmitted).toBe(0);
    expect(d.body.testMode).toBe(true);
    expect(d.body.masterCv).toBeNull();
  });

  it('profile → master CV workflow', async () => {
    const put = await request(app).put('/api/profile').send(sampleProfile());
    expect(put.status).toBe(200);
    expect(put.body.completeness.score).toBe(100);

    const snap = await request(app).post('/api/master-cv/snapshot').send({ notes: 'v1' });
    expect(snap.status).toBe(201);
    expect(snap.body.version).toBe(1);

    const mc = await request(app).get('/api/master-cv');
    expect(mc.body.latest.content.personal.firstName).toBe('Alex');
    expect(mc.body.versions).toHaveLength(1);
  });

  it('returns 422 with details on invalid profile', async () => {
    const res = await request(app).put('/api/profile').send({ personal: { email: 'nope' } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('settings get/update/validation', async () => {
    const res = await request(app).put('/api/settings/classification').send({ greenMin: 88, yellowMin: 70 });
    expect(res.body.settings.classification).toEqual({ greenMin: 88, yellowMin: 70 });
    expect((await request(app).put('/api/settings/llm').send({ maxTokens: 1 })).status).toBe(422);
    expect((await request(app).put('/api/settings/unknown').send({})).status).toBe(404);
  });

  it('CV upload via multipart', async () => {
    const res = await request(app).post('/api/cv/import').attach('file', await sampleDocx(), 'cv.docx');
    expect(res.status).toBe(201);
    expect(res.body.draft.personal.email).toBe('alex.martin@example.com');
    const verify = await request(app).get(`/api/cv/imports/${res.body.id}/verify`);
    expect(verify.body.intact).toBe(true);
    const list = await request(app).get('/api/cv/imports');
    expect(list.body[0].status).toBe('extracted');
  });

  it('unknown API route → 404 JSON', async () => {
    expect((await request(app).get('/api/does-not-exist')).status).toBe(404);
  });
});
