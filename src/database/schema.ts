import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { MasterCvContent, Preferences, WorkAuthorization } from '../models/index.js';
import { encryptedJson, encryptedText } from './types.js';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const timestamps = {
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
};
const jsonList = (name: string) => text(name, { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`);

// ───────────────────────────── Candidate ─────────────────────────────

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  displayName: text('display_name').notNull().default('Me'),
  ...timestamps,
});

/** Personal fields are encrypted at rest. */
export const candidateProfiles = sqliteTable('candidate_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  firstName: encryptedText('first_name'),
  lastName: encryptedText('last_name'),
  email: encryptedText('email'),
  phone: encryptedText('phone'),
  currentLocation: encryptedText('current_location'),
  linkedin: encryptedText('linkedin'),
  portfolio: encryptedText('portfolio'),
  website: encryptedText('website'),
  headline: text('headline'),
  summary: text('summary'),
  workAuthorization: encryptedJson<WorkAuthorization>()('work_authorization'),
  preferences: text('preferences', { mode: 'json' }).$type<Preferences>(),
  ...timestamps,
});

export const education = sqliteTable('education', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: integer('profile_id').notNull().references(() => candidateProfiles.id, { onDelete: 'cascade' }),
  school: text('school').notNull(),
  degree: text('degree'),
  field: text('field'),
  startDate: text('start_date'),
  endDate: text('end_date'),
  gpa: text('gpa'),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const experiences = sqliteTable('experiences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: integer('profile_id').notNull().references(() => candidateProfiles.id, { onDelete: 'cascade' }),
  company: text('company').notNull(),
  title: text('title').notNull(),
  location: text('location'),
  startDate: text('start_date'),
  endDate: text('end_date'),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
  description: text('description'),
  achievements: jsonList('achievements'),
  technologies: jsonList('technologies'),
  skills: jsonList('skills'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const skills = sqliteTable('skills', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: integer('profile_id').notNull().references(() => candidateProfiles.id, { onDelete: 'cascade' }),
  category: text('category', { enum: ['technical', 'language', 'soft', 'certification'] }).notNull(),
  name: text('name').notNull(),
  level: text('level'),
  sortOrder: integer('sort_order').notNull().default(0),
});

/** Uploaded original CV files. The file on disk is never modified (integrity via sha256). */
export const cvDocuments = sqliteTable('cv_documents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  originalFilename: text('original_filename').notNull(),
  mimeType: text('mime_type').notNull(),
  storedPath: text('stored_path').notNull(),
  sha256: text('sha256').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  extractedText: encryptedText('extracted_text'),
  extraction: encryptedJson<unknown>()('extraction'),
  extractionMethod: text('extraction_method', { enum: ['heuristic', 'llm'] }),
  status: text('status', { enum: ['uploaded', 'extracted', 'failed'] }).notNull().default('uploaded'),
  error: text('error'),
  ...timestamps,
});

// ───────────────────────────── Documents ─────────────────────────────

/** kind=master → Master CV versions; kind=tailored → per-job resumes (Phase 4). */
export const resumes = sqliteTable(
  'resumes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['master', 'tailored'] }).notNull(),
    version: integer('version').notNull(),
    jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    masterResumeId: integer('master_resume_id'),
    sourceCvDocumentId: integer('source_cv_document_id').references(() => cvDocuments.id, { onDelete: 'set null' }),
    content: encryptedJson<MasterCvContent>()('content').notNull(),
    pdfPath: text('pdf_path'),
    docxPath: text('docx_path'),
    notes: text('notes'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [uniqueIndex('resumes_kind_job_version_idx').on(t.userId, t.kind, t.jobId, t.version)],
);

export const coverLetters = sqliteTable('cover_letters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: integer('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  resumeId: integer('resume_id').references(() => resumes.id, { onDelete: 'set null' }),
  version: integer('version').notNull().default(1),
  content: encryptedText('content').notNull(),
  txtPath: text('txt_path'),
  pdfPath: text('pdf_path'),
  docxPath: text('docx_path'),
  createdAt: text('created_at').notNull().default(now),
});

// ───────────────────────────── Jobs ─────────────────────────────

export const jobSources = sqliteTable('job_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['api', 'ats', 'feed', 'manual'] }).notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  /** Whether the platform's terms allow automated access. If false → manual/semi-auto only. */
  automationAllowed: integer('automation_allowed', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
  ...timestamps,
});

export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobUid: text('job_uid').notNull().unique(),
    sourceId: integer('source_id').references(() => jobSources.id, { onDelete: 'set null' }),
    sourceUrl: text('source_url').notNull().unique(),
    /** Jobs judged identical across sources share a duplicate group (Phase 2). */
    duplicateGroupId: integer('duplicate_group_id'),
    company: text('company').notNull(),
    title: text('title').notNull(),
    location: text('location'),
    description: text('description'),
    requirements: jsonList('requirements'),
    responsibilities: jsonList('responsibilities'),
    skills: jsonList('skills'),
    salary: text('salary'),
    employmentType: text('employment_type'),
    internshipDuration: text('internship_duration'),
    startDate: text('start_date'),
    endDate: text('end_date'),
    postedDate: text('posted_date'),
    applicationUrl: text('application_url'),
    status: text('status').notNull().default('FOUND'),
    raw: text('raw', { mode: 'json' }),
    ...timestamps,
  },
  (t) => [index('jobs_company_title_idx').on(t.company, t.title), index('jobs_status_idx').on(t.status)],
);

export const jobAnalysis = sqliteTable('job_analysis', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: integer('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  overallScore: integer('overall_score').notNull(),
  dateStatus: text('date_status', { enum: ['COMPATIBLE', 'INCOMPATIBLE', 'UNKNOWN'] }).notNull(),
  dateCompatibility: integer('date_compatibility'),
  locationCompatibility: integer('location_compatibility'),
  skillsMatch: integer('skills_match'),
  experienceMatch: integer('experience_match'),
  educationMatch: integer('education_match'),
  preferencesMatch: integer('preferences_match'),
  category: text('category', { enum: ['GREEN', 'YELLOW', 'RED'] }).notNull(),
  reasons: jsonList('reasons'),
  missingRequirements: jsonList('missing_requirements'),
  redFlags: jsonList('red_flags'),
  matchedSkills: jsonList('matched_skills'),
  missingSkills: jsonList('missing_skills'),
  model: text('model'),
  promptVersion: text('prompt_version'),
  costUsd: real('cost_usd'),
  createdAt: text('created_at').notNull().default(now),
});

// ───────────────────────────── Applications ─────────────────────────────

export const applications = sqliteTable('applications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: integer('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('FOUND'),
  /** Per-job override of the global mode; null = use Settings. */
  mode: text('mode', { enum: ['FULL_AUTO', 'SEMI_AUTO', 'MANUAL'] }),
  resumeId: integer('resume_id').references(() => resumes.id, { onDelete: 'set null' }),
  coverLetterId: integer('cover_letter_id').references(() => coverLetters.id, { onDelete: 'set null' }),
  isSimulation: integer('is_simulation', { mode: 'boolean' }).notNull().default(true),
  applicationDate: text('application_date'),
  /** Set ONLY when the target site confirmed the submission. */
  submittedAt: text('submitted_at'),
  confirmationText: text('confirmation_text'),
  confirmationUrl: text('confirmation_url'),
  screenshotPath: text('screenshot_path'),
  notes: text('notes'),
  followUpDate: text('follow_up_date'),
  ...timestamps,
});

export const applicationAnswers = sqliteTable('application_answers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  question: text('question').notNull(),
  normalizedQuestion: text('normalized_question').notNull(),
  answer: encryptedText('answer'),
  aliases: jsonList('aliases'),
  category: text('category'),
  requiresConfirmation: integer('requires_confirmation', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
});

export const applicationEvents = sqliteTable('application_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  applicationId: integer('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  message: text('message'),
  data: text('data', { mode: 'json' }),
  createdAt: text('created_at').notNull().default(now),
});

// ───────────────────────────── System ─────────────────────────────

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull().default(now),
});

export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  level: text('level', { enum: ['info', 'warning', 'action_required', 'error'] }).notNull().default('info'),
  title: text('title').notNull(),
  message: text('message').notNull(),
  link: text('link'),
  readAt: text('read_at'),
  createdAt: text('created_at').notNull().default(now),
});
