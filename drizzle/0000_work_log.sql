CREATE TABLE `teams` (`id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `name_key` text NOT NULL, `created_at` integer NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_teams_name_key` ON `teams` (`name_key`);
--> statement-breakpoint
CREATE TABLE `users` (`id` text PRIMARY KEY NOT NULL, `team_id` text NOT NULL, `name` text NOT NULL, `name_key` text NOT NULL, `pin_salt` text NOT NULL, `pin_hash` text NOT NULL, `created_at` integer NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_team_name` ON `users` (`team_id`,`name_key`);
--> statement-breakpoint
CREATE TABLE `sessions` (`token` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `expires_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE `entries` (`id` text PRIMARY KEY NOT NULL, `team_id` text NOT NULL, `user_id` text NOT NULL, `project` text NOT NULL, `description` text NOT NULL, `latitude` text, `longitude` text, `created_at` integer NOT NULL);
--> statement-breakpoint
CREATE INDEX `idx_entries_team_created` ON `entries` (`team_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `photos` (`id` text PRIMARY KEY NOT NULL, `entry_id` text NOT NULL, `team_id` text NOT NULL, `object_key` text NOT NULL, `content_type` text NOT NULL, `created_at` integer NOT NULL);
--> statement-breakpoint
CREATE INDEX `idx_photos_entry` ON `photos` (`entry_id`);
