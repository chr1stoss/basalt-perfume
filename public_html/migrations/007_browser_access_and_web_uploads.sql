-- Browser access and server-side price-list uploads. Apply once to the shared MySQL database.
CREATE TABLE IF NOT EXISTS web_upload_jobs (
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
  UNIQUE KEY uq_web_upload_price_list (price_list_id),
  KEY idx_web_upload_status (status, created_at, id),
  KEY idx_web_upload_owner (owner_tg_id),
  CONSTRAINT fk_web_upload_price_list FOREIGN KEY (price_list_id) REFERENCES price_lists(id) ON DELETE CASCADE,
  CONSTRAINT fk_web_upload_owner FOREIGN KEY (owner_tg_id) REFERENCES users(tg_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO app_settings(setting_key, setting_value) VALUES
  ('browser_access_enabled', '0'),
  ('web_price_upload_enabled', '0')
ON DUPLICATE KEY UPDATE setting_value=setting_value;
