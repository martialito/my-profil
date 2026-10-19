import { eq } from 'drizzle-orm';
import type { Db } from '../database/client.js';
import { candidateProfiles, users } from '../database/schema.js';

/**
 * Single-user application: the first user row is "me".
 * The users table exists so the schema can evolve to multi-user later.
 */
export function ensureDefaultUser(db: Db): { userId: number; profileId: number } {
  return db.transaction((tx) => {
    let user = tx.select().from(users).limit(1).get();
    if (!user) user = tx.insert(users).values({ displayName: 'Me' }).returning().get();
    let profile = tx.select({ id: candidateProfiles.id }).from(candidateProfiles).where(eq(candidateProfiles.userId, user.id)).get();
    if (!profile) profile = tx.insert(candidateProfiles).values({ userId: user.id }).returning({ id: candidateProfiles.id }).get();
    return { userId: user.id, profileId: profile.id };
  });
}
