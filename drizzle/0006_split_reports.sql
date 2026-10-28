ALTER TABLE `users` ADD COLUMN `default_project` text NOT NULL DEFAULT '';
ALTER TABLE `entries` ADD COLUMN `entry_type` text NOT NULL DEFAULT 'worklog';
