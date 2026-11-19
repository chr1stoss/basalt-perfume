-- Basalt Perfume consolidated additive upgrade (existing installations).
-- Back up the database first. Select the target database before running this file.
-- This script adds compatibility columns/tables for WebApp language, notifications,
-- persistent bot menu, encrypted activation keys, roles, and price multipliers.
-- It does NOT drop tables or delete application data. Safe to rerun on supported MySQL/MariaDB.
-- Do NOT run 00_full_install.sql on an existing production database.


-- ===== Included migration: 03_upgrade_existing_language.sql =====
-- Safe additive upgrade for an existing Basalt Perfume WebApp database.
-- Run in phpMyAdmin after selecting the database used by htdocs/config/database.php.
-- No tables or rows are dropped.
SET @db_name = DATABASE();
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='user_settings' AND COLUMN_NAME='language')=0,
  "ALTER TABLE user_settings ADD COLUMN language ENUM('ru','en','kz') NOT NULL DEFAULT 'ru' AFTER tg_id",
  'SELECT 1');
PREPARE basalt_stmt FROM @sql; EXECUTE basalt_stmt; DEALLOCATE PREPARE basalt_stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='users' AND COLUMN_NAME='photo_url')=0,
  'ALTER TABLE users ADD COLUMN photo_url VARCHAR(512) NULL AFTER last_name',
  'SELECT 1');
PREPARE basalt_stmt FROM @sql; EXECUTE basalt_stmt; DEALLOCATE PREPARE basalt_stmt;
-- Existing users retain their rows; missing settings rows are inserted by the bot/API on login.


-- ===== Included migration: 04_telegram_notification_cleanup.sql =====
-- Add delayed cleanup queue for Telegram notification photos. Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS telegram_message_cleanup (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  notification_id BIGINT UNSIGNED NULL,
  delete_after DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_telegram_message_cleanup (chat_id, message_id),
  KEY idx_telegram_cleanup_due (delete_after)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ===== Included migration: 06_subscription_key_ciphertext.sql =====
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


-- ===== Included migration: 07_persistent_bot_menu.sql =====
-- Persist the main Telegram menu message so /start?start=switch_lang_en can edit it
-- even after the bot process restarts. Safe to run repeatedly; no data is dropped.
SET @db_name = DATABASE();
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='user_settings' AND COLUMN_NAME='menu_chat_id')=0,
  'ALTER TABLE user_settings ADD COLUMN menu_chat_id BIGINT NULL AFTER notify_subscription',
  'SELECT 1');
PREPARE basalt_stmt FROM @sql; EXECUTE basalt_stmt; DEALLOCATE PREPARE basalt_stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='user_settings' AND COLUMN_NAME='menu_message_id')=0,
  'ALTER TABLE user_settings ADD COLUMN menu_message_id BIGINT NULL AFTER menu_chat_id',
  'SELECT 1');
PREPARE basalt_stmt FROM @sql; EXECUTE basalt_stmt; DEALLOCATE PREPARE basalt_stmt;


-- ===== Included migration: 08_roles_price_multiplier_key_format.sql =====
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


-- ===== Included migration: 10_none_role_favorites.sql =====
SET @db_name = DATABASE();
SET @sql = "ALTER TABLE users MODIFY COLUMN role ENUM('admin','seller','buyer','none') NOT NULL DEFAULT 'none'";
PREPARE basalt_stmt FROM @sql; EXECUTE basalt_stmt; DEALLOCATE PREPARE basalt_stmt;
CREATE TABLE IF NOT EXISTS user_favorites (user_tg_id BIGINT NOT NULL, product_id BIGINT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_tg_id, product_id), KEY idx_user_favorites_product (product_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
