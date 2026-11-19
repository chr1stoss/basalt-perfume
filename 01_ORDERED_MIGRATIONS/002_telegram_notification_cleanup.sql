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
