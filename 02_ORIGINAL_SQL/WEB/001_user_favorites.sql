CREATE TABLE IF NOT EXISTS user_favorites (
  user_tg_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_tg_id, product_id),
  KEY idx_user_favorites_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
