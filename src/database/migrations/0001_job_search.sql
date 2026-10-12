CREATE TABLE `company_boards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`token` text NOT NULL,
	`company_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_fetched_at` text,
	`last_error` text,
	`last_job_count` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_boards_provider_token_idx` ON `company_boards` (`provider`,`token`);--> statement-breakpoint
CREATE TABLE `search_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger` text NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`finished_at` text,
	`stats` text,
	`errors` text
);
--> statement-breakpoint
ALTER TABLE `jobs` ADD `department` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `workplace_type` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `location_match` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `period_hints` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `last_seen_at` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `closed_at` text;