import { z } from 'zod';

/** Lifecycle of a job offer (applications have their own statuses, see statuses.ts). */
export const JobStatuses = ['FOUND', 'ANALYZED', 'SHORTLISTED', 'SKIPPED'] as const;
export type JobStatus = (typeof JobStatuses)[number];

export const SourceKeys = ['greenhouse', 'lever', 'manual', 'linkedin', 'indeed', 'glassdoor', 'welcometothejungle', 'workday', 'company-site'] as const;
export type SourceKey = (typeof SourceKeys)[number];

export type LocationMatch = 'nyc' | 'near' | 'remote' | 'none';

/** A job offer normalized from any source, before it is stored. */
export interface NormalizedJob {
  sourceKey: SourceKey;
  /** Stable id within the source (e.g. Greenhouse job id). */
  externalId: string;
  sourceUrl: string;
  applicationUrl?: string;
  company: string;
  title: string;
  location?: string;
  /** All locations listed by the source (Lever allLocations, Greenhouse offices). */
  allLocations: string[];
  description?: string;
  requirements: string[];
  responsibilities: string[];
  skills: string[];
  salary?: string;
  employmentType?: string;
  internshipDuration?: string;
  startDate?: string;
  endDate?: string;
  periodHints: string[];
  postedDate?: string;
  department?: string;
  workplaceType?: string;
  raw?: unknown;
}

export const JobListQuerySchema = z.object({
  q: z.string().trim().optional(),
  source: z.string().optional(),
  status: z.enum(JobStatuses).optional(),
  location: z.string().trim().optional(),
  locationMatch: z.enum(['nyc', 'near', 'remote']).optional(),
  duration: z.string().trim().optional(),
  startDate: z.string().trim().optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  category: z.enum(['GREEN', 'YELLOW', 'RED', 'NONE']).optional(),
  dateStatus: z.enum(['COMPATIBLE', 'INCOMPATIBLE', 'UNKNOWN']).optional(),
  includeDuplicates: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  includeClosed: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  sort: z.enum(['posted', 'found', 'company', 'score']).default('found'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type JobListQuery = z.infer<typeof JobListQuerySchema>;

export const ManualJobSchema = z.object({
  url: z.url(),
  company: z.string().trim().optional(),
  title: z.string().trim().optional(),
  location: z.string().trim().optional(),
  description: z.string().trim().max(100_000).optional(),
  salary: z.string().trim().optional(),
  postedDate: z.string().trim().optional(),
  applicationUrl: z.url().optional(),
});
export type ManualJobInput = z.infer<typeof ManualJobSchema>;
