CREATE TABLE `serial_youtube_video_classification` (
	`video_id` text(11) PRIMARY KEY NOT NULL,
	`orientation` text NOT NULL,
	`classified_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `serial_feed_item` ADD `orientation_checked_at` integer;--> statement-breakpoint
CREATE INDEX `feed_item_feed_id_orientation_checked_at_idx` ON `serial_feed_item` (`feed_id`,`orientation`,`orientation_checked_at`);