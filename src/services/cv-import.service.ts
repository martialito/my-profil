import fs from 'node:fs';
import path from 'node:path';
import { desc, eq, sql } from 'drizzle-orm';
import { paths } from '../config/env.js';
import { extractProfileHeuristically } from '../cv/heuristic-extractor.js';
import { extractProfileWithLlm } from '../cv/llm-extractor.js';
import { detectCvFileType, extractText } from '../cv/text-extraction.js';
import type { CvExtractionDraft } from '../cv/extraction-types.js';
import type { Db } from '../database/client.js';
import { cvDocuments } from '../database/schema.js';
import { getLlmProvider } from '../llm/index.js';
import { sha256 } from '../utils/crypto.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { SettingsService } from './settings.service.js';
import { ensureDefaultUser } from './user.service.js';

export const MAX_CV_BYTES = 10 * 1024 * 1024;

export interface CvImportResult {
  id: number;
  originalFilename: string;
  sha256: string;
  method: 'heuristic' | 'llm';
  textLength: number;
  draft: CvExtractionDraft;
}

export class CvImportService {
  constructor(private readonly db: Db) {}

  async import(file: { buffer: Buffer; originalname: string }, opts: { useLlm: boolean }): Promise<CvImportResult> {
    if (file.buffer.length === 0) throw new AppError('Empty file');
    if (file.buffer.length > MAX_CV_BYTES) throw new AppError('File too large (max 10 MB)', 413);
    const type = detectCvFileType(file.buffer);
    if (!type) throw new AppError('Unsupported file: only PDF and DOCX are accepted', 415, 'UNSUPPORTED_FILE');

    const { userId } = ensureDefaultUser(this.db);
    const hash = sha256(file.buffer);

    // Store the ORIGINAL bytes untouched, read-only, content-addressed.
    const dir = path.join(paths.uploads(), 'cv');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const storedPath = path.join(dir, `${hash}.${type}`);
    if (!fs.existsSync(storedPath)) {
      fs.writeFileSync(storedPath, file.buffer, { mode: 0o400 });
    }

    const row = this.db
      .insert(cvDocuments)
      .values({
        userId,
        originalFilename: path.basename(file.originalname).slice(0, 200),
        mimeType: type === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        storedPath: path.relative(process.cwd(), storedPath),
        sha256: hash,
        sizeBytes: file.buffer.length,
      })
      .returning({ id: cvDocuments.id })
      .get();

    try {
      const text = await extractText(file.buffer, type);
      if (text.length < 50) {
        throw new AppError('Almost no text could be read from this file (scanned image?). Please enter your profile manually or upload a text-based PDF/DOCX.', 422, 'NO_TEXT');
      }
      let method: 'heuristic' | 'llm' = 'heuristic';
      let draft: CvExtractionDraft;
      if (opts.useLlm) {
        if (!getLlmProvider().isConfigured()) {
          throw new AppError('Claude extraction requested but ANTHROPIC_API_KEY is not configured', 400, 'LLM_NOT_CONFIGURED');
        }
        draft = await extractProfileWithLlm(text, new SettingsService(this.db).get().llm);
        method = 'llm';
      } else {
        draft = extractProfileHeuristically(text);
      }
      this.db
        .update(cvDocuments)
        .set({ extractedText: text, extraction: draft, extractionMethod: method, status: 'extracted', updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` })
        .where(eq(cvDocuments.id, row.id))
        .run();
      logger.info(`CV imported (${type}, ${method} extraction)`, { id: row.id });
      return { id: row.id, originalFilename: file.originalname, sha256: hash, method, textLength: text.length, draft };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.db.update(cvDocuments).set({ status: 'failed', error: reason }).where(eq(cvDocuments.id, row.id)).run();
      logger.stepError({ step: 'CV import', reason });
      throw err;
    }
  }

  list() {
    return this.db
      .select({
        id: cvDocuments.id,
        originalFilename: cvDocuments.originalFilename,
        mimeType: cvDocuments.mimeType,
        sha256: cvDocuments.sha256,
        sizeBytes: cvDocuments.sizeBytes,
        status: cvDocuments.status,
        extractionMethod: cvDocuments.extractionMethod,
        error: cvDocuments.error,
        createdAt: cvDocuments.createdAt,
      })
      .from(cvDocuments)
      .orderBy(desc(cvDocuments.id))
      .all();
  }

  get(id: number) {
    const row = this.db.select().from(cvDocuments).where(eq(cvDocuments.id, id)).get();
    if (!row) throw new NotFoundError(`CV document ${id}`);
    return row;
  }

  /** Re-hash the stored file to prove the original is intact. */
  verifyIntegrity(id: number): { intact: boolean; expected: string; actual?: string } {
    const row = this.get(id);
    const abs = path.resolve(process.cwd(), row.storedPath);
    if (!fs.existsSync(abs)) return { intact: false, expected: row.sha256 };
    const actual = sha256(fs.readFileSync(abs));
    return { intact: actual === row.sha256, expected: row.sha256, actual };
  }

  originalFile(id: number): { absPath: string; filename: string; mimeType: string } {
    const row = this.get(id);
    return { absPath: path.resolve(process.cwd(), row.storedPath), filename: row.originalFilename, mimeType: row.mimeType };
  }
}
