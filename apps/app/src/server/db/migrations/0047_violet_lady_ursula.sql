CREATE TABLE `serial_bookmark_tag` (
	`bookmark_id` text NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`bookmark_id`, `tag_id`),
	FOREIGN KEY (`bookmark_id`) REFERENCES `serial_bookmark`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `serial_content_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bookmark_tag_tag_id_idx` ON `serial_bookmark_tag` (`tag_id`);--> statement-breakpoint
CREATE TABLE `serial_bookmark_view` (
	`bookmark_id` text NOT NULL,
	`view_id` integer NOT NULL,
	PRIMARY KEY(`bookmark_id`, `view_id`),
	FOREIGN KEY (`bookmark_id`) REFERENCES `serial_bookmark`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`view_id`) REFERENCES `serial_views`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bookmark_view_view_id_idx` ON `serial_bookmark_view` (`view_id`);--> statement-breakpoint
CREATE TABLE `serial_bookmark` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_url` text NOT NULL,
	`effective_url` text DEFAULT '' NOT NULL,
	`canonical_url` text NOT NULL,
	`platform` text DEFAULT 'website' NOT NULL,
	`content_type` text DEFAULT 'text' NOT NULL,
	`orientation` text,
	`content_id` text,
	`classification_source` text DEFAULT 'url' NOT NULL,
	`classifier_version` integer DEFAULT 1 NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`description` text,
	`author` text,
	`site_name` text,
	`published_at` integer,
	`thumbnail_url` text,
	`icon_url` text,
	`preview_source` text DEFAULT 'url' NOT NULL,
	`is_saved` integer DEFAULT true NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`duration` integer DEFAULT 0 NOT NULL,
	`saved_updated_at` integer NOT NULL,
	`read_updated_at` integer NOT NULL,
	`progress_updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `serial_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bookmark_user_id_idx` ON `serial_bookmark` (`user_id`);--> statement-breakpoint
CREATE INDEX `bookmark_user_saved_saved_at_idx` ON `serial_bookmark` (`user_id`,`is_saved`,`saved_updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `bookmark_user_saved_read_read_at_idx` ON `serial_bookmark` (`user_id`,`is_saved`,`is_read`,`read_updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `bookmark_user_saved_read_created_at_idx` ON `serial_bookmark` (`user_id`,`is_saved`,`is_read`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bookmark_user_id_canonical_url_unique` ON `serial_bookmark` (`user_id`,`canonical_url`);--> statement-breakpoint
CREATE UNIQUE INDEX `bookmark_user_id_platform_content_id_unique` ON `serial_bookmark` (`user_id`,`platform`,`content_id`);--> statement-breakpoint
CREATE TABLE `serial_extension_session` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `serial_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `serial_extension_session_token_hash_unique` ON `serial_extension_session` (`token_hash`);--> statement-breakpoint
CREATE INDEX `extension_session_user_id_idx` ON `serial_extension_session` (`user_id`);--> statement-breakpoint
CREATE INDEX `extension_session_expires_at_idx` ON `serial_extension_session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `serial_page_capture` (
	`bookmark_id` text PRIMARY KEY NOT NULL,
	`content_html` text NOT NULL,
	`content_hash` text NOT NULL,
	`capture_source` text NOT NULL,
	`extractor_version` text NOT NULL,
	`sanitizer_policy_version` integer NOT NULL,
	`captured_at` integer NOT NULL,
	FOREIGN KEY (`bookmark_id`) REFERENCES `serial_bookmark`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP INDEX `feed_is_active_next_fetch_at_idx`;--> statement-breakpoint
CREATE INDEX `feed_user_id_is_active_next_fetch_at_idx` ON `serial_feed` (`user_id`,`is_active`,`next_fetch_at`);--> statement-breakpoint
ALTER TABLE `serial_feed_item` ADD `normalized_url` text(4096);--> statement-breakpoint
ALTER TABLE `serial_feed_item` ADD `content_type` text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE `serial_views` ADD `content_filter` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
-- Hand-authored data preservation: this must run before Drizzle drops content_type.
UPDATE `serial_views`
SET `content_filter` = CASE `content_type`
	WHEN 'longform' THEN 3
	WHEN 'horizontal-video' THEN 2
	WHEN 'vertical-video' THEN 4
	WHEN 'all' THEN 7
	ELSE 3
END;--> statement-breakpoint
ALTER TABLE `serial_views` DROP COLUMN `orientation`;--> statement-breakpoint
ALTER TABLE `serial_views` DROP COLUMN `content_type`;
