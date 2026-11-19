-- Basalt Perfume: durable queue for WebApp update broadcasts.
-- Safe to rerun; no existing tables or records are removed.
CREATE TABLE IF NOT EXISTS telegram_notification_queue (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  notification_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL,
  title VARCHAR(190) NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at DATETIME NULL,
  sent_at DATETIME NULL,
  last_error VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tg_notification_chat (notification_id, chat_id),
  KEY idx_tg_notification_queue_status (status, available_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
