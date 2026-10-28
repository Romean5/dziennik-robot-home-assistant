ALTER TABLE `users` ADD COLUMN `role` text NOT NULL DEFAULT 'member';
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `status` text NOT NULL DEFAULT 'active';
--> statement-breakpoint
UPDATE `users` SET `role`='admin' WHERE `created_at`=(SELECT MIN(u2.`created_at`) FROM `users` u2 WHERE u2.`team_id`=`users`.`team_id`);
