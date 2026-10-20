-- Run against the existing Basalt Perfume database before deploying this version.
-- Back up the database first. Keeps existing role assignments and maps legacy 'user' to 'seller'.
SET @db_name = DATABASE();
SET @has_role = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='users' AND COLUMN_NAME='role');
SET @sql = IF(@has_role=0, "ALTER TABLE users ADD COLUMN role ENUM('admin','seller','buyer','none') NOT NULL DEFAULT 'none' AFTER last_name", "ALTER TABLE users MODIFY COLUMN role ENUM('admin','user','seller','buyer','none') NOT NULL DEFAULT 'none'");
PREPARE basalt_stmt FROM @sql; EXECUTE basalt_stmt; DEALLOCATE PREPARE basalt_stmt;
UPDATE users SET role='seller' WHERE role='user' OR role IS NULL OR role='';
UPDATE users SET role='admin' WHERE tg_id IN (SELECT tg_id FROM admins);
ALTER TABLE users MODIFY COLUMN role ENUM('admin','seller','buyer','none') NOT NULL DEFAULT 'none';
