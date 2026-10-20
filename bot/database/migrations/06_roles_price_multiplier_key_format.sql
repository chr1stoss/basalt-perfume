-- Basalt Perfume: additive migration for seller/buyer roles, price boost, and new activation keys.
-- Run this on the EXISTING database before deploying the updated application.
-- Does not drop tables or delete existing data; re-runnable on MySQL/MariaDB.
SET @db_name = DATABASE();

SET @has_role = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='users' AND COLUMN_NAME='role');
SET @sql = IF(@has_role=0, "ALTER TABLE users ADD COLUMN role ENUM('admin','seller','buyer','none') NOT NULL DEFAULT 'none' AFTER last_name", "ALTER TABLE users MODIFY COLUMN role ENUM('admin','user','seller','buyer','none') NOT NULL DEFAULT 'none'");
PREPARE basalt_stmt FROM @sql; EXECUTE basalt_stmt; DEALLOCATE PREPARE basalt_stmt;

-- In the old schema non-admin accounts used role='user'. The staging enum above
-- preserves those values long enough to migrate them without coercing them to an empty enum value.
UPDATE users SET role='seller' WHERE role='user' OR role IS NULL OR role='';
UPDATE users SET role='admin' WHERE tg_id IN (SELECT tg_id FROM admins);
SET @sql = "ALTER TABLE users MODIFY COLUMN role ENUM('admin','seller','buyer','none') NOT NULL DEFAULT 'none'";
PREPARE basalt_stmt FROM @sql; EXECUTE basalt_stmt; DEALLOCATE PREPARE basalt_stmt;

SET @has_user_multiplier = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='users' AND COLUMN_NAME='price_multiplier');
SET @sql = IF(@has_user_multiplier=0, 'ALTER TABLE users ADD COLUMN price_multiplier DECIMAL(7,2) NOT NULL DEFAULT 1.00 AFTER role', 'SELECT 1');
PREPARE basalt_stmt FROM @sql; EXECUTE basalt_stmt; DEALLOCATE PREPARE basalt_stmt;

SET @has_ban_details = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='users' AND COLUMN_NAME='ban_details');
SET @sql = IF(@has_ban_details=0, 'ALTER TABLE users ADD COLUMN ban_details TEXT NULL AFTER ban_reason', 'SELECT 1');
PREPARE basalt_stmt FROM @sql; EXECUTE basalt_stmt; DEALLOCATE PREPARE basalt_stmt;

SET @has_multiplier = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='products' AND COLUMN_NAME='price_multiplier');
SET @sql = IF(@has_multiplier=0, 'ALTER TABLE products ADD COLUMN price_multiplier DECIMAL(7,2) NOT NULL DEFAULT 1.00 AFTER price_usd', 'SELECT 1');
PREPARE basalt_stmt FROM @sql; EXECUTE basalt_stmt; DEALLOCATE PREPARE basalt_stmt;

SET @has_key_ciphertext = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='subscription_keys' AND COLUMN_NAME='key_ciphertext');
SET @sql = IF(@has_key_ciphertext=0, 'ALTER TABLE subscription_keys ADD COLUMN key_ciphertext TEXT NULL AFTER key_prefix', 'SELECT 1');
PREPARE basalt_stmt FROM @sql; EXECUTE basalt_stmt; DEALLOCATE PREPARE basalt_stmt;

SET @has_key_prefix = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='subscription_keys' AND COLUMN_NAME='key_prefix');
SET @sql = IF(@has_key_prefix>0, 'ALTER TABLE subscription_keys MODIFY COLUMN key_prefix VARCHAR(32) NOT NULL', 'SELECT 1');
PREPARE basalt_stmt FROM @sql; EXECUTE basalt_stmt; DEALLOCATE PREPARE basalt_stmt;

UPDATE users SET price_multiplier=1.00 WHERE price_multiplier IS NULL OR price_multiplier<0.10 OR price_multiplier>100.00;
UPDATE products SET price_multiplier=1.00 WHERE price_multiplier IS NULL OR price_multiplier<0.10 OR price_multiplier>100.00;
