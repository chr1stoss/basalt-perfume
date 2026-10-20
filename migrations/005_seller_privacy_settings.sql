-- Privacy-first seller settings. Run this migration once in phpMyAdmin.
-- Existing and new sellers default to private products and disabled direct messages.
SET @bp_db := DATABASE();
SET @bp_sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@bp_db AND TABLE_NAME='user_settings' AND COLUMN_NAME='seller_products_public')=0,
  'ALTER TABLE user_settings ADD COLUMN seller_products_public TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE bp_stmt FROM @bp_sql;
EXECUTE bp_stmt;
DEALLOCATE PREPARE bp_stmt;

SET @bp_sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@bp_db AND TABLE_NAME='user_settings' AND COLUMN_NAME='seller_dm_enabled')=0,
  'ALTER TABLE user_settings ADD COLUMN seller_dm_enabled TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE bp_stmt FROM @bp_sql;
EXECUTE bp_stmt;
DEALLOCATE PREPARE bp_stmt;
