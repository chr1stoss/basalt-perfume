-- Read-only diagnostic for phpMyAdmin. Select the target database before running.
-- Result set 1: current application tables, with MISSING entries highlighted.
SELECT expected.table_name,
       CASE WHEN actual.TABLE_NAME IS NULL THEN 'MISSING' ELSE 'OK' END AS status
FROM (
  SELECT 'admin_logs' AS table_name
  UNION ALL SELECT 'admin_user_deletion_queue'
  UNION ALL SELECT 'admins'
  UNION ALL SELECT 'app_notifications'
  UNION ALL SELECT 'app_settings'
  UNION ALL SELECT 'brand_aliases'
  UNION ALL SELECT 'brands'
  UNION ALL SELECT 'parse_errors'
  UNION ALL SELECT 'price_lists'
  UNION ALL SELECT 'product_components'
  UNION ALL SELECT 'product_defects'
  UNION ALL SELECT 'products'
  UNION ALL SELECT 'source_rows'
  UNION ALL SELECT 'subscription_keys'
  UNION ALL SELECT 'subscription_reminders'
  UNION ALL SELECT 'telegram_message_cleanup'
  UNION ALL SELECT 'telegram_notification_queue'
  UNION ALL SELECT 'user_favorites'
  UNION ALL SELECT 'user_settings'
  UNION ALL SELECT 'users'
) AS expected
LEFT JOIN information_schema.TABLES AS actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = expected.table_name
 AND actual.TABLE_TYPE = 'BASE TABLE'
ORDER BY expected.table_name;

-- Result set 2: extra tables in this database that are not part of the current 20-table bot/WebApp schema.
-- Extra tables may be legacy/other-app tables; inspect them before deciding whether they should be migrated.
SELECT actual.TABLE_NAME AS extra_table
FROM information_schema.TABLES AS actual
LEFT JOIN (
  SELECT 'admin_logs' AS table_name
  UNION ALL SELECT 'admin_user_deletion_queue'
  UNION ALL SELECT 'admins'
  UNION ALL SELECT 'app_notifications'
  UNION ALL SELECT 'app_settings'
  UNION ALL SELECT 'brand_aliases'
  UNION ALL SELECT 'brands'
  UNION ALL SELECT 'parse_errors'
  UNION ALL SELECT 'price_lists'
  UNION ALL SELECT 'product_components'
  UNION ALL SELECT 'product_defects'
  UNION ALL SELECT 'products'
  UNION ALL SELECT 'source_rows'
  UNION ALL SELECT 'subscription_keys'
  UNION ALL SELECT 'subscription_reminders'
  UNION ALL SELECT 'telegram_message_cleanup'
  UNION ALL SELECT 'telegram_notification_queue'
  UNION ALL SELECT 'user_favorites'
  UNION ALL SELECT 'user_settings'
  UNION ALL SELECT 'users'
) AS expected ON expected.table_name = actual.TABLE_NAME
WHERE actual.TABLE_SCHEMA = DATABASE()
  AND actual.TABLE_TYPE = 'BASE TABLE'
  AND expected.table_name IS NULL
ORDER BY actual.TABLE_NAME;
