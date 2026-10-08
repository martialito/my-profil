import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../database/client.js';
import { resumes } from '../database/schema.js';
import { MasterCvContentSchema, type MasterCvVersion } from '../models/master-cv.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { ProfileService } from './profile.service.js';
import { ensureDefaultUser } from './user.service.js';

export class MasterCvService {
  constructor(private readonly db: Db) {}

  /**
   * Freeze the current verified profile as a new Master CV version.
   * Versions are immutable: editing the profile then snapshotting creates a new version.
   */
  createSnapshot(opts: { notes?: string; sourceCvDocumentId?: number } = {}): MasterCvVersion {
    const profile = new ProfileService(this.db).get();
    if (!profile.personal.firstName || !profile.personal.lastName) {
      throw new AppError('First and last name are required before creating a Master CV', 422, 'PROFILE_INCOMPLETE');
    }
    if (profile.experiences.length === 0 && profile.education.length === 0) {
      throw new AppError('Add at least one education or experience entry first', 422, 'PROFILE_INCOMPLETE');
    }
    const content = MasterCvContentSchema.parse(profile);
    const { userId } = ensureDefaultUser(this.db);

    const row = this.db.transaction((tx) => {
      const last = tx
        .select({ version: resumes.version })
        .from(resumes)
        .where(and(eq(resumes.userId, userId), eq(resumes.kind, 'master')))
        .orderBy(desc(resumes.version))
        .limit(1)
        .get();
      return tx
        .insert(resumes)
        .values({
          userId,
          kind: 'master',
          version: (last?.version ?? 0) + 1,
          content,
          notes: opts.notes ?? null,
          sourceCvDocumentId: opts.sourceCvDocumentId ?? null,
        })
        .returning()
        .get();
    });
    logger.info(`Master CV v${row.version} created`);
    return this.toVersion(row);
  }

  latest(): MasterCvVersion | undefined {
    const row = this.db
      .select()
      .from(resumes)
      .where(eq(resumes.kind, 'master'))
      .orderBy(desc(resumes.version))
      .limit(1)
      .get();
    return row ? this.toVersion(row) : undefined;
  }

  getVersion(version: number): MasterCvVersion {
    const row = this.db
      .select()
      .from(resumes)
      .where(and(eq(resumes.kind, 'master'), eq(resumes.version, version)))
      .get();
    if (!row) throw new NotFoundError(`Master CV v${version}`);
    return this.toVersion(row);
  }

  list(): Array<Omit<MasterCvVersion, 'content'>> {
    return this.db
      .select({ id: resumes.id, version: resumes.version, createdAt: resumes.createdAt, notes: resumes.notes })
      .from(resumes)
      .where(eq(resumes.kind, 'master'))
      .orderBy(desc(resumes.version))
      .all()
      .map((r) => ({ id: r.id, version: r.version, createdAt: r.createdAt, notes: r.notes ?? undefined }));
  }

  private toVersion(row: typeof resumes.$inferSelect): MasterCvVersion {
    return {
      id: row.id,
      version: row.version,
      createdAt: row.createdAt,
      notes: row.notes ?? undefined,
      sourceCvDocumentId: row.sourceCvDocumentId ?? undefined,
      content: MasterCvContentSchema.parse(row.content),
    };
  }
}
