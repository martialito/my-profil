export type NotificationLevel = 'info' | 'warning' | 'action_required' | 'error';

export interface NotificationInput {
  type: string;
  level: NotificationLevel;
  title: string;
  message: string;
  /** In-app link, e.g. "/jobs/12". */
  link?: string;
  /** Same key → created only once. */
  dedupeKey?: string;
}

/**
 * A delivery channel. Only the dashboard channel exists today (notifications stored in the database).
 * Email / Telegram / Discord can be added later by implementing this interface.
 */
export interface NotificationChannel {
  readonly name: string;
  deliver(n: NotificationInput & { id: number }): Promise<void> | void;
}
