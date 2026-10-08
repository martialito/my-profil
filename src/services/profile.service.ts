import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../database/client.js';
import { candidateProfiles, education, experiences, skills } from '../database/schema.js';
import {
  CandidateProfileSchema,
  PreferencesSchema,
  type CandidateProfile,
  type CandidateProfileInput,
} from '../models/profile.js';
import { AppError } from '../utils/errors.js';
import { ensureDefaultUser } from './user.service.js';

const nullable = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

export class ProfileService {
  constructor(private readonly db: Db) {}

  get(): CandidateProfile {
    const { profileId } = ensureDefaultUser(this.db);
    const p = this.db.select().from(candidateProfiles).where(eq(candidateProfiles.id, profileId)).get();
    if (!p) throw new AppError('Profile missing', 500);
    const edu = this.db.select().from(education).where(eq(education.profileId, profileId)).orderBy(asc(education.sortOrder)).all();
    const exp = this.db.select().from(experiences).where(eq(experiences.profileId, profileId)).orderBy(asc(experiences.sortOrder)).all();
    const sk = this.db.select().from(skills).where(eq(skills.profileId, profileId)).orderBy(asc(skills.sortOrder)).all();

    return CandidateProfileSchema.parse({
      personal: {
        firstName: opt(p.firstName),
        lastName: opt(p.lastName),
        email: opt(p.email),
        phone: opt(p.phone),
        currentLocation: opt(p.currentLocation),
        linkedin: opt(p.linkedin),
        portfolio: opt(p.portfolio),
        website: opt(p.website),
      },
      headline: opt(p.headline),
      summary: opt(p.summary),
      workAuthorization: p.workAuthorization ?? {},
      preferences: PreferencesSchema.parse(p.preferences ?? {}),
      education: edu.map((e) => ({
        id: e.id,
        school: e.school,
        degree: opt(e.degree),
        field: opt(e.field),
        startDate: opt(e.startDate),
        endDate: opt(e.endDate),
        gpa: opt(e.gpa),
        description: opt(e.description),
      })),
      experiences: exp.map((e) => ({
        id: e.id,
        company: e.company,
        title: e.title,
        location: opt(e.location),
        startDate: opt(e.startDate),
        endDate: opt(e.endDate),
        isCurrent: e.isCurrent,
        description: opt(e.description),
        achievements: e.achievements,
        technologies: e.technologies,
        skills: e.skills,
      })),
      skills: sk.map((s) => ({ id: s.id, category: s.category, name: s.name, level: opt(s.level) })),
    });
  }

  /** Replace the whole profile atomically (the UI always sends the full, user-verified profile). */
  save(input: CandidateProfileInput): CandidateProfile {
    const parsed = CandidateProfileSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError('Invalid profile', 422, 'VALIDATION_ERROR', parsed.error.issues);
    }
    const p = parsed.data;
    const { profileId } = ensureDefaultUser(this.db);

    this.db.transaction((tx) => {
      tx.update(candidateProfiles)
        .set({
          firstName: nullable(p.personal.firstName),
          lastName: nullable(p.personal.lastName),
          email: nullable(p.personal.email),
          phone: nullable(p.personal.phone),
          currentLocation: nullable(p.personal.currentLocation),
          linkedin: nullable(p.personal.linkedin),
          portfolio: nullable(p.personal.portfolio),
          website: nullable(p.personal.website),
          headline: nullable(p.headline),
          summary: nullable(p.summary),
          workAuthorization: p.workAuthorization,
          preferences: p.preferences,
          updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        })
        .where(eq(candidateProfiles.id, profileId))
        .run();

      tx.delete(education).where(eq(education.profileId, profileId)).run();
      tx.delete(experiences).where(eq(experiences.profileId, profileId)).run();
      tx.delete(skills).where(eq(skills.profileId, profileId)).run();

      p.education.forEach((e, i) =>
        tx.insert(education)
          .values({
            profileId,
            school: e.school,
            degree: nullable(e.degree),
            field: nullable(e.field),
            startDate: nullable(e.startDate),
            endDate: nullable(e.endDate),
            gpa: nullable(e.gpa),
            description: nullable(e.description),
            sortOrder: i,
          })
          .run(),
      );
      p.experiences.forEach((e, i) =>
        tx.insert(experiences)
          .values({
            profileId,
            company: e.company,
            title: e.title,
            location: nullable(e.location),
            startDate: nullable(e.startDate),
            endDate: nullable(e.endDate),
            isCurrent: e.isCurrent,
            description: nullable(e.description),
            achievements: e.achievements,
            technologies: e.technologies,
            skills: e.skills,
            sortOrder: i,
          })
          .run(),
      );
      p.skills.forEach((s, i) =>
        tx.insert(skills)
          .values({ profileId, category: s.category, name: s.name, level: nullable(s.level), sortOrder: i })
          .run(),
      );
    });

    return this.get();
  }
}
