-- Remove favorites that no longer resolve to a product in an existing price list.
-- Safe to run once against an existing production database after taking a backup.
DELETE f
FROM user_favorites AS f
LEFT JOIN products AS p ON p.id = f.product_id
LEFT JOIN source_rows AS sr ON sr.id = p.source_row_id
LEFT JOIN price_lists AS pl ON pl.id = sr.price_list_id
WHERE p.id IS NULL OR sr.id IS NULL OR pl.id IS NULL;
