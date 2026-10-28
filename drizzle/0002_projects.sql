CREATE TABLE `projects` (`id` text PRIMARY KEY NOT NULL, `team_id` text NOT NULL, `name` text NOT NULL, `created_at` integer NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_projects_team_name` ON `projects` (`team_id`,`name`);
