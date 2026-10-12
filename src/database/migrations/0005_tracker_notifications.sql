ALTER TABLE `applications` ADD `confirmation_source` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `dedupe_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe_key_unique` ON `notifications` (`dedupe_key`);