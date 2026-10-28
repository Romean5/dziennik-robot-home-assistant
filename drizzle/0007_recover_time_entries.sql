INSERT INTO `entries` (`id`,`team_id`,`user_id`,`entry_type`,`company`,`project`,`description`,`hours`,`kilometers`,`work_date`,`latitude`,`longitude`,`created_at`)
SELECT `id` || '-time',`team_id`,`user_id`,'timesheet',`company`,`project`,'',`hours`,`kilometers`,`work_date`,NULL,NULL,`created_at`
FROM `entries`
WHERE `entry_type`='worklog' AND (CAST(`hours` AS REAL)>0 OR CAST(`kilometers` AS REAL)>0);
