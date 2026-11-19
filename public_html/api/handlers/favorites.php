<?php
if ($action === 'favorites') {
    if (!in_array($auth['role'], array('buyer','seller'), true) && empty($auth['is_admin'])) respond(false,array('error'=>'role_forbidden','message'=>'Избранное доступно покупателям, продавцам и администраторам.'),403);
    require_active_subscription($tgId);
    ensure_user_favorites_table($pdo);
    $isBuyerFavoriteView=$auth['role']==='buyer'&&empty($auth['is_admin']);
    $isSellerFavoriteView=$auth['role']==='seller'&&empty($auth['is_admin']);
    $sellerOwnLists=0;
    if($isSellerFavoriteView){$ownLists=$pdo->prepare('SELECT COUNT(*) FROM price_lists WHERE owner_tg_id=?');$ownLists->execute(array($tgId));$sellerOwnLists=(int)$ownLists->fetchColumn();}
    $favoritesSql="SELECT p.id,p.brand,p.name,p.type,p.category,p.volume_ml,p.volume_text,p.display_kind,p.size_width,p.size_height,p.size_unit,(p.price_usd*p.price_multiplier) AS price_usd,p.price_usd AS base_price,p.price_multiplier,p.currency,p.gender,p.is_tester,p.is_set,1 AS is_favorite,pl.id AS file_id,pl.filename,pl.owner_tg_id AS seller_tg_id,u.username AS seller_username,TRIM(CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,''))) AS seller_name,COALESCE(seller_privacy.seller_products_public,0) AS seller_products_public,COALESCE(seller_privacy.seller_dm_enabled,0) AS seller_dm_enabled FROM user_favorites f JOIN products p ON p.id=f.product_id JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id LEFT JOIN users u ON u.tg_id=pl.owner_tg_id LEFT JOIN user_settings seller_privacy ON seller_privacy.tg_id=pl.owner_tg_id WHERE f.user_tg_id=?";
    if($isBuyerFavoriteView)$favoritesSql.=' AND COALESCE(seller_privacy.seller_products_public,0)=1';
    elseif($isSellerFavoriteView&&$sellerOwnLists>0)$favoritesSql.=' AND pl.owner_tg_id=?';
    elseif($isSellerFavoriteView)$favoritesSql.=' AND COALESCE(seller_privacy.seller_products_public,0)=1';
    $favoritesSql.=' ORDER BY pl.owner_tg_id,p.name ASC LIMIT 1000';
    $favoriteArgs=array($tgId);if($isSellerFavoriteView&&$sellerOwnLists>0)$favoriteArgs[]=$tgId;
    $stmt=$pdo->prepare($favoritesSql);$stmt->execute($favoriteArgs);$favoriteRows=$stmt->fetchAll();
    foreach($favoriteRows as &$favoriteRow){$favoriteRow['seller_dm_available']=(!empty($auth['is_admin'])||((int)$favoriteRow['seller_products_public']===1&&(int)$favoriteRow['seller_dm_enabled']===1))?1:0;if($isBuyerFavoriteView&&empty($favoriteRow['seller_dm_available']))$favoriteRow['seller_username']=null;unset($favoriteRow['seller_products_public'],$favoriteRow['seller_dm_enabled']);}unset($favoriteRow);
    respond(true,$favoriteRows,200);
}
if ($action === 'favorite_toggle') {
    if (!in_array($auth['role'], array('buyer','seller'), true) && empty($auth['is_admin'])) respond(false,array('error'=>'role_forbidden','message'=>'Избранное доступно покупателям, продавцам и администраторам.'),403);
    require_active_subscription($tgId);
    ensure_user_favorites_table($pdo);
    $productId=isset($input['product_id'])?(int)$input['product_id']:0;
    if ($productId<1) respond(false,array('error'=>'invalid_product_id'),400);
    $exists=$pdo->prepare('SELECT id FROM products WHERE id=? LIMIT 1'); $exists->execute(array($productId));
    if (!$exists->fetchColumn()) respond(false,array('error'=>'product_not_found','message'=>'Товар больше не найден в каталоге.'),404);
    $wantFavorite=!empty($input['favorite']);
    if ($wantFavorite && empty($auth['is_admin']) && in_array($auth['role'], array('buyer','seller'), true)) {
        if ($auth['role']==='buyer') {
            $publicCheck=$pdo->prepare('SELECT 1 FROM products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id LEFT JOIN user_settings seller_privacy ON seller_privacy.tg_id=pl.owner_tg_id WHERE p.id=? AND COALESCE(seller_privacy.seller_products_public,0)=1 LIMIT 1');
            $publicCheck->execute(array($productId));
        } else {
            $ownLists=$pdo->prepare('SELECT COUNT(*) FROM price_lists WHERE owner_tg_id=?');$ownLists->execute(array($tgId));
            if ((int)$ownLists->fetchColumn()>0) {
                $publicCheck=$pdo->prepare('SELECT 1 FROM products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id WHERE p.id=? AND pl.owner_tg_id=? LIMIT 1');
                $publicCheck->execute(array($productId,$tgId));
            } else {
                $publicCheck=$pdo->prepare('SELECT 1 FROM products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id LEFT JOIN user_settings seller_privacy ON seller_privacy.tg_id=pl.owner_tg_id WHERE p.id=? AND COALESCE(seller_privacy.seller_products_public,0)=1 LIMIT 1');
                $publicCheck->execute(array($productId));
            }
        }
        if (!$publicCheck->fetchColumn()) respond(false,array('error'=>'product_not_found','message'=>'Товар недоступен.'),404);
    }
    if ($wantFavorite) {
        $stmt=$pdo->prepare('INSERT IGNORE INTO user_favorites(user_tg_id,product_id) VALUES(?,?)'); $stmt->execute(array($tgId,$productId));
    } else {
        $stmt=$pdo->prepare('DELETE FROM user_favorites WHERE user_tg_id=? AND product_id=?'); $stmt->execute(array($tgId,$productId));
    }
    $countStmt=$pdo->prepare('SELECT COUNT(*) n FROM user_favorites WHERE user_tg_id=?'); $countStmt->execute(array($tgId));
    respond(true,array('is_favorite'=>$wantFavorite,'favorites_count'=>(int)$countStmt->fetch()['n']),200);
}
