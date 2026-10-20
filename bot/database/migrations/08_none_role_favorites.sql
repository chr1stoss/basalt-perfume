-- Basalt Perfume: enable the None role and buyer favourites.
-- Safe to rerun. Back up the database before applying to production.
SET @db_name = DATABASE();
SET @has_role = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='users' AND COLUMN_NAME='role');
SET @sql = IF(@has_role=0, "ALTER TABLE users ADD COLUMN role ENUM('admin','seller','buyer','none') NOT NULL DEFAULT 'none' AFTER last_name", "ALTER TABLE users MODIFY COLUMN role ENUM('admin','user','seller','buyer','none') NOT NULL DEFAULT 'none'");
PREPARE basalt_stmt FROM @sql; EXECUTE basalt_stmt; DEALLOCATE PREPARE basalt_stmt;
UPDATE users SET role='seller' WHERE role='user' OR role IS NULL OR role='';
UPDATE users SET role='admin' WHERE tg_id IN (SELECT tg_id FROM admins);
ALTER TABLE users MODIFY COLUMN role ENUM('admin','seller','buyer','none') NOT NULL DEFAULT 'none';
CREATE TABLE IF NOT EXISTS user_favorites (
  user_tg_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_tg_id, product_id),
  KEY idx_user_favorites_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
