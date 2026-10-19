import { z } from 'zod';
import { CandidateProfileSchema } from './profile.js';

/**
 * The Master CV is an immutable, versioned snapshot of the verified candidate profile.
 * It is the single source of truth for every tailored resume and cover letter.
 * Preferences and motivations are intentionally excluded: they are not CV content.
 */
export const MasterCvContentSchema = CandidateProfileSchema.omit({ preferences: true, motivations: true });
export type MasterCvContent = z.infer<typeof MasterCvContentSchema>;

export interface MasterCvVersion {
  id: number;
  version: number;
  createdAt: string;
  notes?: string;
  sourceCvDocumentId?: number;
  content: MasterCvContent;
}
