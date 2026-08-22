UPDATE serial_feed_item
SET
  orientation = CASE
    WHEN INSTR(url, '/shorts/') > 0 THEN 'vertical'
    ELSE NULL
  END,
  orientation_checked_at = NULL
WHERE feed_id IN (
  SELECT id
  FROM serial_feed
  WHERE platform = 'youtube'
);
