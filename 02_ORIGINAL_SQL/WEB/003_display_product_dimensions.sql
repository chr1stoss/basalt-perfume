-- DISPLAY product dimensions and split SHOWCARD/BILLBOARD type values.
-- Safe to run more than once on MySQL/MariaDB. Back up the DB before applying.
SET @db_name = DATABASE();

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='products' AND COLUMN_NAME='display_kind')=0,
  'ALTER TABLE products ADD COLUMN display_kind VARCHAR(20) NULL AFTER volume_text', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='products' AND COLUMN_NAME='size_width')=0,
  'ALTER TABLE products ADD COLUMN size_width DECIMAL(10,3) NULL AFTER display_kind', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='products' AND COLUMN_NAME='size_height')=0,
  'ALTER TABLE products ADD COLUMN size_height DECIMAL(10,3) NULL AFTER size_width', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='products' AND COLUMN_NAME='size_unit')=0,
  'ALTER TABLE products ADD COLUMN size_unit ENUM(''mm'',''cm'') NULL AFTER size_height', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Preserve the distinct type for existing rows using the raw source title.
UPDATE products
SET type='SHOWCARD', display_kind='showcard', volume_ml=NULL, volume_text=NULL
WHERE CONCAT(COALESCE(raw_title,''),' ',COALESCE(name,'')) REGEXP 'show[[:space:]]*card|шоу[[:space:]]*кард|шоукард';

UPDATE products
SET type='BILLBOARD', display_kind='billboard', volume_ml=NULL, volume_text=NULL
WHERE CONCAT(COALESCE(raw_title,''),' ',COALESCE(name,'')) REGEXP 'bill[[:space:]]*board|billboard|билборд';

UPDATE products
SET display_kind=CASE UPPER(type)
    WHEN 'SHOWCARD' THEN 'showcard'
    WHEN 'BILLBOARD' THEN 'billboard'
    WHEN 'DISPLAY' THEN 'display'
    ELSE display_kind
  END,
  volume_ml=CASE WHEN UPPER(type) IN ('DISPLAY','SHOWCARD','BILLBOARD') THEN NULL ELSE volume_ml END,
  volume_text=CASE WHEN UPPER(type) IN ('DISPLAY','SHOWCARD','BILLBOARD') THEN NULL ELSE volume_text END
WHERE UPPER(COALESCE(type,'')) IN ('DISPLAY','SHOWCARD','BILLBOARD');
