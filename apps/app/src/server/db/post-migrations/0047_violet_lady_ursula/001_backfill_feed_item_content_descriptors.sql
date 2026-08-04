UPDATE serial_feed_item
SET content_type = CASE (
  SELECT platform
  FROM serial_feed
  WHERE serial_feed.id = serial_feed_item.feed_id
)
  WHEN 'website' THEN 'text'
  ELSE 'video'
END;
--> statement-breakpoint
UPDATE serial_feed_item
SET normalized_url = SUBSTR(url, 1, INSTR(url, '#') - 1)
WHERE normalized_url IS NULL
  AND INSTR(url, '#') > 0;
