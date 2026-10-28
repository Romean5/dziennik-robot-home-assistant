ALTER TABLE `users` ADD COLUMN `default_company` text NOT NULL DEFAULT '';
ALTER TABLE `entries` ADD COLUMN `company` text NOT NULL DEFAULT '';
