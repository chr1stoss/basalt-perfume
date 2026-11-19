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
