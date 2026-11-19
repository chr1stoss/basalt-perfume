-- Full demo bootstrap: final schema + cumulative fixes + one activation key per supported role.
-- Basalt Perfume schema for Percona Server / MySQL 8.
-- Select the target database in phpMyAdmin before importing.
-- Does not create/use a database, for shared hosting compatibility.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS=0;

-- Merged upgrades: users.photo_url and user_settings.language (03_*), plus telegram_message_cleanup (04_*).
-- The final column/table definitions below already include those fixes; do not run the ALTER scripts after this dump.
-- WARNING: destructive full reset of application/catalog data. Use only for local/demo or fresh setup.
DROP TABLE IF EXISTS
  `telegram_message_cleanup`,
  `parse_errors`,
  `admin_logs`,
  `subscription_reminders`,
  `admins`,
  `app_notifications`,
  `user_settings`,
  `product_defects`,
  `product_components`,
  `products`,
  `source_rows`,
  `price_lists`,
  `brand_aliases`,
  `brands`,
  `subscription_keys`,
  `users`,
  `app_settings`;

CREATE TABLE users (
  tg_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  username VARCHAR(64) NULL,
  first_name VARCHAR(128) NULL,
  last_name VARCHAR(128) NULL,
  role ENUM('admin','seller','buyer','none') NOT NULL DEFAULT 'none',
  price_multiplier DECIMAL(7,2) NOT NULL DEFAULT 1.00,
  photo_url VARCHAR(512) NULL,
  is_blocked TINYINT(1) NOT NULL DEFAULT 0,
  banned_until DATETIME NULL COMMENT 'NULL with is_blocked=1 means permanent; future datetime means temporary ban',
  ban_reason VARCHAR(500) NULL,
  ban_details TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE subscription_keys (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  key_hash CHAR(64) NOT NULL UNIQUE,
  key_prefix VARCHAR(32) NOT NULL,
  key_ciphertext TEXT NULL,
  owner_tg_id BIGINT UNSIGNED NULL,
  used_by_tg_id BIGINT UNSIGNED NULL,
  usable TINYINT(1) NOT NULL DEFAULT 1,
  duration_days INT NOT NULL,
  role_on_activate VARCHAR(10) NULL DEFAULT NULL,
  activated_at DATETIME NULL,
  available_until DATETIME NULL,
  is_frozen TINYINT(1) NOT NULL DEFAULT 0,
  frozen_at DATETIME NULL,
  frozen_remaining_sec BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_key_owner (owner_tg_id), KEY idx_key_used_by (used_by_tg_id),
  CONSTRAINT fk_keys_owner FOREIGN KEY (owner_tg_id) REFERENCES users(tg_id) ON DELETE SET NULL,
  CONSTRAINT fk_keys_used FOREIGN KEY (used_by_tg_id) REFERENCES users(tg_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `brands` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  normalized_name VARCHAR(255) NOT NULL,
  sources_json LONGTEXT NULL,
  aliases_json LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_brands_normalized (normalized_name),
  KEY idx_brands_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `brand_aliases` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  alias VARCHAR(255) NOT NULL,
  normalized_alias VARCHAR(255) NOT NULL,
  canonical_brand VARCHAR(255) NOT NULL,
  brand_id BIGINT UNSIGNED NULL,
  source VARCHAR(100) NULL,
  confidence DECIMAL(5,4) NULL,
  ambiguous TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_brand_alias_normalized (normalized_alias),
  KEY idx_brand_alias_canonical (canonical_brand),
  CONSTRAINT fk_brand_alias_brand FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `price_lists` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  owner_tg_id BIGINT UNSIGNED NULL,
  filepath VARCHAR(512) NULL,
  size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'ready',
  supplier_name VARCHAR(255) NULL,
  imported_at DATETIME NOT NULL,
  parser_version VARCHAR(32) NOT NULL,
  UNIQUE KEY uq_price_lists_owner_filename (owner_tg_id, filename),
  KEY idx_price_lists_owner (owner_tg_id),
  CONSTRAINT fk_price_lists_owner FOREIGN KEY (owner_tg_id) REFERENCES users(tg_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `source_rows` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  price_list_id BIGINT UNSIGNED NOT NULL,
  source_file VARCHAR(255) NOT NULL,
  source_sheet VARCHAR(255) NOT NULL,
  source_row_number INT UNSIGNED NOT NULL,
  row_status VARCHAR(32) NOT NULL,
  title_candidate TEXT NULL,
  raw_price VARCHAR(255) NULL,
  column_roles_json LONGTEXT NULL,
  raw_cells_json LONGTEXT NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  notes TEXT NULL,
  UNIQUE KEY uq_source_coordinate (price_list_id, source_sheet, source_row_number),
  KEY idx_source_status (row_status),
  KEY idx_source_price_list (price_list_id),
  KEY idx_source_title (title_candidate(191)),
  CONSTRAINT fk_source_price_list FOREIGN KEY (price_list_id) REFERENCES price_lists(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `products` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  source_row_id BIGINT UNSIGNED NOT NULL,
  article VARCHAR(255) NULL,
  article_raw VARCHAR(255) NULL,
  brand VARCHAR(255) NULL,
  brand_id BIGINT UNSIGNED NULL,
  brand_match_method VARCHAR(64) NULL,
  name TEXT NOT NULL,
  type VARCHAR(40) NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'other',
  defects_json LONGTEXT NULL,
  volume_ml DECIMAL(10,3) NULL,
  volume_text VARCHAR(80) NULL,
  display_kind VARCHAR(20) NULL,
  size_width DECIMAL(10,3) NULL,
  size_height DECIMAL(10,3) NULL,
  size_unit ENUM('mm','cm') NULL,
  price_usd DECIMAL(12,4) NULL,
  price_multiplier DECIMAL(7,2) NOT NULL DEFAULT 1.00,
  price_raw VARCHAR(255) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  gender ENUM('M','F','U') NULL,
  gender_from_name VARCHAR(255) NULL,
  is_tester TINYINT(1) NOT NULL DEFAULT 0,
  is_sample TINYINT(1) NOT NULL DEFAULT 0,
  is_set TINYINT(1) NOT NULL DEFAULT 0,
  set_component_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  extra_info_json LONGTEXT NULL,
  raw_title TEXT NOT NULL,
  raw_cells_json LONGTEXT NOT NULL,
  source_file VARCHAR(255) NOT NULL,
  source_sheet VARCHAR(255) NOT NULL,
  source_row_number INT UNSIGNED NOT NULL,
  parse_confidence DECIMAL(4,3) NOT NULL DEFAULT 0,
  needs_review TINYINT(1) NOT NULL DEFAULT 0,
  review_reasons_json LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_products_brand (brand),
  KEY idx_products_name (name(191)),
  KEY idx_products_article (article),
  KEY idx_products_type (type),
  KEY idx_products_gender (gender),
  KEY idx_products_price (price_usd),
  KEY idx_products_set (is_set),
  KEY idx_products_review (needs_review),
  KEY idx_products_source_row (source_row_id),
  KEY idx_products_brand_id (brand_id),
  CONSTRAINT fk_product_source_row FOREIGN KEY (source_row_id) REFERENCES source_rows(id) ON DELETE CASCADE,
  CONSTRAINT fk_product_brand FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_components` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  parent_product_id BIGINT UNSIGNED NOT NULL,
  sequence_no SMALLINT UNSIGNED NOT NULL,
  brand VARCHAR(255) NULL,
  name TEXT NOT NULL,
  type VARCHAR(40) NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'other',
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
  volume_ml DECIMAL(10,3) NULL,
  volume_text VARCHAR(80) NULL,
  gender ENUM('M','F','U') NULL,
  raw_component TEXT NOT NULL,
  needs_review TINYINT(1) NOT NULL DEFAULT 0,
  review_reasons_json LONGTEXT NULL,
  UNIQUE KEY uq_component_order (parent_product_id, sequence_no),
  KEY idx_component_brand (brand),
  KEY idx_component_type (type),
  CONSTRAINT fk_component_parent FOREIGN KEY (parent_product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_defects` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT UNSIGNED NOT NULL,
  defect_code VARCHAR(40) NOT NULL,
  UNIQUE KEY uq_product_defect (product_id, defect_code),
  CONSTRAINT fk_defect_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_settings (
  tg_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  language ENUM('ru','en','kz') NOT NULL DEFAULT 'ru',
  theme VARCHAR(24) NOT NULL DEFAULT 'mono',
  appearance ENUM('dark','light','system') NOT NULL DEFAULT 'dark',
  notify_updates TINYINT(1) NOT NULL DEFAULT 1,
  notify_processed_files TINYINT(1) NOT NULL DEFAULT 1,
  notify_subscription TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_settings_user FOREIGN KEY (tg_id) REFERENCES users(tg_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE app_settings (
  setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE app_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tg_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('update','file_processed','subscription','system') NOT NULL DEFAULT 'system',
  title VARCHAR(190) NOT NULL,
  body TEXT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notifications_user (tg_id, is_read, created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (tg_id) REFERENCES users(tg_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE admins (
  tg_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_admin_user FOREIGN KEY (tg_id) REFERENCES users(tg_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE subscription_reminders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  subscription_key_id BIGINT UNSIGNED NOT NULL,
  hours_before_expiry SMALLINT UNSIGNED NOT NULL,
  sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_subscription_reminder (subscription_key_id, hours_before_expiry),
  CONSTRAINT fk_reminder_key FOREIGN KEY (subscription_key_id) REFERENCES subscription_keys(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE admin_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  admin_tg_id BIGINT UNSIGNED NULL,
  action VARCHAR(64) NOT NULL,
  details TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_admin_logs_admin (admin_tg_id),
  CONSTRAINT fk_admin_logs_user FOREIGN KEY (admin_tg_id) REFERENCES users(tg_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE parse_errors (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tg_id BIGINT UNSIGNED NOT NULL,
  file_id BIGINT UNSIGNED NULL,
  row_index INT NULL,
  raw_title TEXT NULL,
  error_code VARCHAR(64) NOT NULL,
  details TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_errors_owner (tg_id),
  CONSTRAINT fk_errors_user FOREIGN KEY (tg_id) REFERENCES users(tg_id) ON DELETE CASCADE,
  CONSTRAINT fk_errors_file FOREIGN KEY (file_id) REFERENCES price_lists(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS=1;

-- Default application settings; no catalogue or user rows are imported.
INSERT INTO app_settings (setting_key, setting_value) VALUES
  ('developer_username', 'YOUR_TELEGRAM_USERNAME'),
  ('support_faq', 'Загрузите прайс-лист через бота. Обработка может занять некоторое время.'),
  ('max_file_size_mb', '20'),
  ('max_files_per_upload', '10');

-- Add delayed cleanup queue for Telegram notification photos. Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS `telegram_message_cleanup` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `chat_id` BIGINT NOT NULL,
  `message_id` BIGINT NOT NULL,
  `notification_id` BIGINT UNSIGNED NULL,
  `delete_after` DATETIME NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY `uq_telegram_message_cleanup` (chat_id, message_id),
  KEY `idx_telegram_cleanup_due` (delete_after)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Demo-only activation keys: one for each role. Raw values are for local testing only.
-- The database stores SHA-256 hashes, and role_on_activate pins the resulting role.
INSERT INTO subscription_keys (key_hash, key_prefix, usable, duration_days, role_on_activate) VALUES
  (SHA2('DEMO-BUYER-30D-A1B2', 256), 'DEMO-BUYER', 1, 30, 'buyer'),
  (SHA2('DEMO-SELLER-30D-C3D4', 256), 'DEMO-SELLER', 1, 30, 'seller'),
  (SHA2('DEMO-ADMIN-30D-E5F6', 256), 'DEMO-ADMIN', 1, 30, 'admin');

-- Buyer favourites (the 10_none_role_favorites migration adds this to existing installs).
CREATE TABLE IF NOT EXISTS user_favorites (
  user_tg_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_tg_id, product_id),
  KEY idx_user_favorites_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- Durable delivery queue for admin update announcements.
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
