<?php
/* Cache the current user's Telegram avatar for WebApp and ordinary browser sessions. */
if ($action === 'cache_avatar') {
    $authPhoto = isset($auth['user']['photo_url']) ? trim((string)$auth['user']['photo_url']) : '';
    $st = $pdo->prepare('SELECT photo_url FROM users WHERE tg_id=? LIMIT 1');
    $st->execute(array($tgId));
    $storedPhoto = trim((string)$st->fetchColumn());
    $forceRefresh = !empty($input['refresh']);
    $hasStoredAvatar = avatar_url_is_local($storedPhoto) && is_file(BP_PUBLIC_ROOT . $storedPhoto);

    // Browser sessions resolve_user_auth() intentionally contains only the Telegram ID;
    // in that case the signed OIDC picture URL is already persisted in users.photo_url.
    $sourcePhoto = '';
    if ($authPhoto !== '' && !avatar_url_is_local($authPhoto) && preg_match('~^https://~i', $authPhoto)) {
        $sourcePhoto = $authPhoto;
    } elseif ($storedPhoto !== '' && !avatar_url_is_local($storedPhoto) && preg_match('~^https://~i', $storedPhoto)) {
        $sourcePhoto = $storedPhoto;
    }

    // Reuse a local cache when no fresh signed source URL is available (normal browser
    // session after first cache, or a Telegram account without a current photo_url).
    if ($hasStoredAvatar && $sourcePhoto === '') {
        respond(true, array('photo_url'=>$storedPhoto, 'cached'=>true, 'refreshed'=>false), 200);
    }

    $cachedUrl = $sourcePhoto !== '' ? cache_telegram_avatar_from_url($tgId, $sourcePhoto, $forceRefresh) : null;
    if ($cachedUrl) {
        // Keep an external Telegram source URL in users.photo_url so it can be
        // retried on the next page open. Only store a local path when no source URL
        // exists (Bot API fallback); otherwise the per-user cache is ephemeral metadata.
        if ($sourcePhoto === '') {
            $pdo->prepare('UPDATE users SET photo_url=? WHERE tg_id=?')->execute(array($cachedUrl, $tgId));
        }
        respond(true, array('photo_url'=>$cachedUrl, 'cached'=>true), 200);
    }

    // Do not replace a known-good local image with a placeholder when Telegram is
    // temporarily unreachable or its CDN redirects are unavailable.
    if ($hasStoredAvatar) {
        respond(true, array('photo_url'=>$storedPhoto, 'cached'=>true, 'refreshed'=>false), 200);
    }

    $cachedUrl = cache_telegram_avatar_from_bot_api($tgId, $config, $forceRefresh);
    if ($cachedUrl) {
        if ($sourcePhoto === '') {
            $pdo->prepare('UPDATE users SET photo_url=? WHERE tg_id=?')->execute(array($cachedUrl, $tgId));
        }
        respond(true, array('photo_url'=>$cachedUrl, 'cached'=>true), 200);
    }
    respond(true, array('cached'=>false), 200);
}
if ($action === 'overview' || $action === 'me') {
    // A no-role or expired user only needs the subscription gate. Do not query
    // profile settings, catalogue counts, files, notifications or favorites.
    $sub = subscription_for($tgId);
    if (empty($auth['is_admin']) && ($auth['role'] === 'none' || !$sub || empty($sub['active']))) {
        respond(true, array(
            'profile' => array('tg_id'=>(int)$tgId, 'role'=>$auth['role'], 'is_blocked'=>false, 'ban_active'=>false),
            'role'=>$auth['role'], 'subscription'=>$sub,
            'has_ever_activated_subscription'=>!empty($sub),
            'favorites_count'=>0, 'files_count'=>0, 'products_count'=>0, 'unread_count'=>0,
            'is_admin'=>false, 'browser_features'=>browser_features($pdo),
            'developer_username'=>$config['developer_username'],
            'bot_username'=>$config['bot_username'],
            'system'=>maintenance_state($pdo)
        ), 200);
    }
    $stmt = $pdo->prepare('SELECT u.tg_id,u.username,u.first_name,u.last_name,u.role,u.price_multiplier,u.photo_url,u.is_blocked,u.banned_until,u.ban_reason,u.ban_details,s.language,s.theme,s.appearance,s.notify_updates,s.notify_processed_files,s.notify_subscription FROM users u LEFT JOIN user_settings s ON s.tg_id=u.tg_id WHERE u.tg_id=?');
    $stmt->execute(array($tgId)); $profile = $stmt->fetch();
    if (!empty($auth['is_admin'])) {
        $files=(int)$pdo->query('SELECT COUNT(*) n FROM price_lists')->fetch()['n'];
        $products=(int)$pdo->query('SELECT COUNT(*) n FROM products')->fetch()['n'];
    } elseif ($auth['role'] === 'buyer') {
        $files=0;
        $products=(int)$pdo->query('SELECT COUNT(*) n FROM products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id LEFT JOIN user_settings seller_privacy ON seller_privacy.tg_id=pl.owner_tg_id WHERE COALESCE(seller_privacy.seller_products_public,0)=1')->fetch()['n'];
    } else {
        $stmt = $pdo->prepare('SELECT COUNT(*) n FROM price_lists WHERE owner_tg_id=?'); $stmt->execute(array($tgId)); $files = (int)$stmt->fetch()['n'];
        $stmt = $pdo->prepare('SELECT COUNT(*) n FROM products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id WHERE pl.owner_tg_id=?'); $stmt->execute(array($tgId)); $products = (int)$stmt->fetch()['n'];
    }
    if ($auth['role'] === 'buyer') {
        $stmt = $pdo->prepare("SELECT COUNT(*) n FROM app_notifications WHERE tg_id=? AND is_read=0 AND kind NOT IN ('file_processed','processed_file','file_processing','price_list_processed') AND title NOT LIKE '%обработ%' AND title NOT LIKE '%processing%' AND title NOT LIKE '%processed%' AND body NOT LIKE '%обработ%' AND body NOT LIKE '%processing%' AND body NOT LIKE '%processed%'");
    } else {
        $stmt = $pdo->prepare('SELECT COUNT(*) n FROM app_notifications WHERE tg_id=? AND is_read=0');
    }
    $stmt->execute(array($tgId)); $unread = (int)$stmt->fetch()['n'];
    $sub = isset($sub) ? $sub : subscription_for($tgId);
    $favoritesCount = 0;
    if (in_array($auth['role'], array('buyer','seller'), true) || !empty($auth['is_admin'])) {
        ensure_user_favorites_table($pdo);
        // Count only favorites that still resolve through the full catalogue chain.
        // user_favorites intentionally has no FK to products, so old rows can outlive a price list.
        $favCountStmt = $pdo->prepare('SELECT COUNT(*) n FROM user_favorites f INNER JOIN products p ON p.id=f.product_id INNER JOIN source_rows sr ON sr.id=p.source_row_id INNER JOIN price_lists pl ON pl.id=sr.price_list_id WHERE f.user_tg_id=?');
        $favCountStmt->execute(array($tgId));
        $favoritesCount = (int)$favCountStmt->fetch()['n'];
    }
    $system = maintenance_state($pdo);
    $profile['is_blocked']=(bool)$profile['is_blocked'];
    $profile['ban_active']=$profile['is_blocked'] && (!$profile['banned_until'] || strtotime($profile['banned_until']) > time());
    if ($profile['is_blocked'] && !$profile['ban_active']) { $pdo->prepare('UPDATE users SET is_blocked=0,banned_until=NULL,ban_reason=NULL,ban_details=NULL WHERE tg_id=?')->execute(array($tgId)); $profile['is_blocked']=false; }
    $profile['role']=$auth['role']; $profile['full_name']=trim((string)$profile['first_name'].' '.(string)$profile['last_name']);
    respond(true, array('profile'=>$profile,'role'=>$auth['role'],'subscription'=>$sub,'has_ever_activated_subscription'=>!empty($sub),'favorites_count'=>$favoritesCount,'files_count'=>$files,'products_count'=>$products,'unread_count'=>$unread,'is_admin'=>$auth['is_admin'],'browser_features'=>browser_features($pdo),'developer_username'=>$config['developer_username'],'bot_username'=>$config['bot_username'],'system'=>$system), 200);
}
