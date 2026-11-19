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
