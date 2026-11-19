-- Add optional role assignment to activation keys. Safe to run repeatedly on MySQL/MariaDB.
SET @role_activation_column_count = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscription_keys' AND COLUMN_NAME = 'role_on_activate'
);
SET @role_activation_sql = IF(
  @role_activation_column_count = 0,
  'ALTER TABLE subscription_keys ADD COLUMN role_on_activate VARCHAR(10) NULL DEFAULT NULL AFTER duration_days',
  'SELECT 1'
);
PREPARE role_activation_stmt FROM @role_activation_sql;
EXECUTE role_activation_stmt;
DEALLOCATE PREPARE role_activation_stmt;
