-- Apply on an existing DB before using the admin user deletion feature.
-- No FK to users: the worker must run after the user row has been deleted.
CREATE TABLE IF NOT EXISTS admin_user_deletion_queue (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tg_id BIGINT UNSIGNED NOT NULL,
  requested_by_tg_id BIGINT UNSIGNED NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at DATETIME NULL,
  sent_at DATETIME NULL,
  last_error VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_admin_user_deletion_status (status, available_at, id),
  KEY idx_admin_user_deletion_tg (tg_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
