-- Add encrypted recovery storage for newly generated activation keys.
-- Existing hashes and prefixes remain unchanged; older raw values cannot be reconstructed.
-- Run once against an existing installation. This migration does not drop or rewrite rows.
SET @db_name = DATABASE();
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='subscription_keys' AND COLUMN_NAME='key_ciphertext')=0,
  'ALTER TABLE subscription_keys ADD COLUMN key_ciphertext TEXT NULL AFTER key_prefix',
  'SELECT 1'
);
PREPARE basalt_stmt FROM @sql; EXECUTE basalt_stmt; DEALLOCATE PREPARE basalt_stmt;
