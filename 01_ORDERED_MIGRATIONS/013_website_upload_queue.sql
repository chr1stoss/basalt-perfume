-- Dedicated queue for website uploads. The Telegram bot does not poll this table.
CREATE TABLE IF NOT EXISTS web_upload_site_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  price_list_id BIGINT UNSIGNED NOT NULL,
  owner_tg_id BIGINT UNSIGNED NOT NULL,
  filename VARCHAR(255) NOT NULL,
  filepath VARCHAR(1024) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_at DATETIME NULL,
  last_error VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_web_upload_site_price_list (price_list_id),
  KEY idx_web_upload_site_status (status, created_at, id),
  KEY idx_web_upload_site_owner (owner_tg_id),
  CONSTRAINT fk_web_upload_site_price_list FOREIGN KEY (price_list_id) REFERENCES price_lists(id) ON DELETE CASCADE,
  CONSTRAINT fk_web_upload_site_owner FOREIGN KEY (owner_tg_id) REFERENCES users(tg_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
