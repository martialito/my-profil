ALTER TABLE `cover_letters` ADD `checks` text;--> statement-breakpoint
ALTER TABLE `cover_letters` ADD `edited_by_user` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `resumes` ADD `checks` text;