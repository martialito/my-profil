import { and, count, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../database/client.js';
import { applications, jobs, notifications } from '../database/schema.js';
import { logger } from '../utils/logger.js';
import type { NotificationChannel, NotificationInput } from './types.js';

const NOW = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export class NotificationService {
  constructor(
    private readonly db: Db,
    private readonly channels: NotificationChannel[] = [],
  ) {}

  /** Store a notification (dashboard channel) and forward it to extra channels. Returns null if deduplicated. */
  notify(n: NotificationInput): number | null {
    const row = this.db
      .insert(notifications)
      .values({ type: n.type, level: n.level, title: n.title, message: n.message, link: n.link ?? null, dedupeKey: n.dedupeKey ?? null })
      .onConflictDoNothing({ target: notifications.dedupeKey })
      .returning({ id: notifications.id })
      .get();
    if (!row) return null;
    for (const c of this.channels) {
      Promise.resolve(c.deliver({ ...n, id: row.id })).catch((err: unknown) => logger.warn(`Notification channel ${c.name} failed`, { error: String(err) }));
    }
    return row.id;
  }

  list(opts: { unreadOnly?: boolean; limit?: number } = {}) {
    return this.db
      .select()
      .from(notifications)
      .where(opts.unreadOnly ? isNull(notifications.readAt) : undefined)
      .orderBy(desc(notifications.id))
      .limit(opts.limit ?? 100)
      .all();
  }

  counts() {
    const unread = this.db.select({ n: count() }).from(notifications).where(isNull(notifications.readAt)).get()?.n ?? 0;
    const actionRequired = this.db.select({ n: count() }).from(notifications).where(and(isNull(notifications.readAt), eq(notifications.level, 'action_required'))).get()?.n ?? 0;
    return { unread, actionRequired };
  }

  markRead(id: number): void {
    this.db.update(notifications).set({ readAt: NOW }).where(eq(notifications.id, id)).run();
  }

  markAllRead(): void {
    this.db.update(notifications).set({ readAt: NOW }).where(isNull(notifications.readAt)).run();
  }

  /** Create one reminder per application whose follow-up date has arrived (idempotent). */
  checkFollowUps(today = new Date().toISOString().slice(0, 10)): number {
    const due = this.db
      .select({ id: applications.id, jobId: applications.jobId, followUpDate: applications.followUpDate, company: jobs.company, title: jobs.title })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .where(and(eq(applications.status, 'APPLIED'), lte(applications.followUpDate, today)))
      .all();
    let created = 0;
    for (const a of due) {
      const id = this.notify({
        type: 'follow_up',
        level: 'action_required',
        title: `Follow up: ${a.title} at ${a.company}`,
        message: `You applied to ${a.title} at ${a.company} and have not heard back. It is a good time to send a short follow-up (planned for ${a.followUpDate}).`,
        link: `/tracker?app=${a.id}`,
        dedupeKey: `followup:${a.id}:${a.followUpDate}`,
      });
      if (id) created++;
    }
    if (created) logger.info(`${created} follow-up reminder(s) created`);
    return created;
  }
}
