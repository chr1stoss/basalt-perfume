-- Basalt Perfume v13.10.26: explicit subscription timeline / queued renewals.
-- Existing chained renewals are backfilled to their originally implied start dates.
SET @bp_db = DATABASE();
SET @bp_has_starts_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@bp_db AND TABLE_NAME='subscription_keys' AND COLUMN_NAME='starts_at'
);
SET @bp_sql = IF(@bp_has_starts_at=0,
  'ALTER TABLE subscription_keys ADD COLUMN starts_at DATETIME NULL AFTER activated_at',
  'SELECT 1');
PREPARE bp_stmt FROM @bp_sql; EXECUTE bp_stmt; DEALLOCATE PREPARE bp_stmt;

SET @bp_has_queue_idx = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=@bp_db AND TABLE_NAME='subscription_keys' AND INDEX_NAME='idx_subscription_queue_user_start'
);
SET @bp_sql = IF(@bp_has_queue_idx=0,
  'ALTER TABLE subscription_keys ADD INDEX idx_subscription_queue_user_start (used_by_tg_id, starts_at, available_until)',
  'SELECT 1');
PREPARE bp_stmt FROM @bp_sql; EXECUTE bp_stmt; DEALLOCATE PREPARE bp_stmt;

-- Before explicit starts_at existed, each renewal appended duration to MAX(available_until).
-- Reconstruct each segment's start as the later of its activation request and the previous segment's end.
DROP TEMPORARY TABLE IF EXISTS bp_subscription_queue_backfill;
CREATE TEMPORARY TABLE bp_subscription_queue_backfill AS
SELECT cur.id,
       CASE WHEN MAX(prev.available_until) IS NULL
            THEN COALESCE(cur.activated_at, cur.created_at, NOW())
            ELSE GREATEST(MAX(prev.available_until), COALESCE(cur.activated_at, cur.created_at, NOW()))
       END AS inferred_starts_at
FROM subscription_keys cur
LEFT JOIN subscription_keys prev
  ON prev.used_by_tg_id=cur.used_by_tg_id
 AND prev.used_by_tg_id IS NOT NULL
 AND (COALESCE(prev.activated_at,prev.created_at) < COALESCE(cur.activated_at,cur.created_at)
      OR (COALESCE(prev.activated_at,prev.created_at) = COALESCE(cur.activated_at,cur.created_at) AND prev.id < cur.id))
WHERE cur.used_by_tg_id IS NOT NULL
GROUP BY cur.id, cur.activated_at, cur.created_at;

UPDATE subscription_keys target
JOIN bp_subscription_queue_backfill inferred ON inferred.id=target.id
SET target.starts_at=inferred.inferred_starts_at
WHERE target.starts_at IS NULL AND target.used_by_tg_id IS NOT NULL;
DROP TEMPORARY TABLE IF EXISTS bp_subscription_queue_backfill;

-- Unactivated keys intentionally keep starts_at=NULL.
