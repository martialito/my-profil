import { Router } from 'express';
import type { Db } from '../../database/client.js';
import { SETTINGS_SECTIONS, type SettingsSection } from '../../models/settings.js';
import { SettingsService } from '../../services/settings.service.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';

function section(name: string | undefined): SettingsSection {
  if (!name || !(SETTINGS_SECTIONS as string[]).includes(name)) throw new AppError(`Unknown settings section "${name}"`, 404, 'NOT_FOUND');
  return name as SettingsSection;
}

export function settingsRoutes(db: Db): Router {
  const r = Router();
  const svc = new SettingsService(db);
  r.get('/', (_req, res) => {
    res.json({ settings: svc.get(), env: { testModeForced: env().TEST_MODE, llmConfigured: !!env().ANTHROPIC_API_KEY } });
  });
  r.put('/:section', (req, res) => {
    const s = section(req.params.section);
    svc.update(s, req.body);
    res.json({ settings: svc.get() });
  });
  r.delete('/:section', (req, res) => {
    svc.reset(section(req.params.section));
    res.json({ settings: svc.get() });
  });
  return r;
}
