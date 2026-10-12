import { eq, sql } from 'drizzle-orm';
import { env } from '../config/env.js';
import type { Db } from '../database/client.js';
import { settings as settingsTable } from '../database/schema.js';
import {
  SETTINGS_SECTIONS,
  SettingsSectionSchemas,
  SettingsSchema,
  type Settings,
  type SettingsSection,
} from '../models/settings.js';
import { AppError } from '../utils/errors.js';

export class SettingsService {
  constructor(private readonly db: Db) {}

  /** Stored values merged over defaults. TEST_MODE=true in env always forces automation.testMode. */
  get(): Settings {
    const rows = this.db.select().from(settingsTable).all();
    const raw: Record<string, unknown> = {};
    for (const row of rows) {
      if ((SETTINGS_SECTIONS as string[]).includes(row.key)) raw[row.key] = row.value;
    }
    const parsed = SettingsSchema.safeParse(raw);
    // A corrupted/obsolete section falls back to defaults rather than crashing the app.
    const result = parsed.success ? parsed.data : this.recover(raw);
    if (env().TEST_MODE) result.automation.testMode = true;
    return result;
  }

  update<K extends SettingsSection>(section: K, value: unknown): Settings[K] {
    const schema = SettingsSectionSchemas[section];
    const current = this.get()[section];
    const merged = { ...(current as object), ...(value as object) };
    const parsed = schema.safeParse(merged);
    if (!parsed.success) {
      throw new AppError(`Invalid ${section} settings`, 422, 'VALIDATION_ERROR', parsed.error.issues);
    }
    this.db
      .insert(settingsTable)
      .values({ key: section, value: parsed.data })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: parsed.data, updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` },
      })
      .run();
    return parsed.data as Settings[K];
  }

  reset(section: SettingsSection): void {
    this.db.delete(settingsTable).where(eq(settingsTable.key, section)).run();
  }

  private recover(raw: Record<string, unknown>): Settings {
    const out: Record<string, unknown> = {};
    for (const key of SETTINGS_SECTIONS) {
      const r = SettingsSectionSchemas[key].safeParse(raw[key] ?? {});
      out[key] = r.success ? r.data : SettingsSectionSchemas[key].parse({});
    }
    return out as Settings;
  }
}
