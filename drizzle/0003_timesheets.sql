ALTER TABLE `users` ADD COLUMN `employee_number` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `machine` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `machine_number` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `entries` ADD COLUMN `hours` text NOT NULL DEFAULT '0';
--> statement-breakpoint
ALTER TABLE `entries` ADD COLUMN `kilometers` text NOT NULL DEFAULT '0';
--> statement-breakpoint
ALTER TABLE `entries` ADD COLUMN `work_date` text NOT NULL DEFAULT '';
