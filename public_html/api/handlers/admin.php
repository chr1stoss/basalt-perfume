<?php
if ($action === 'reveal_subscription_key') {
    admin_required($auth);
    $keyId = isset($input['key_id']) ? (int)$input['key_id'] : 0;
    if ($keyId < 1) respond(false, array('error' => 'invalid_key_id', 'message' => 'Не удалось определить ключ.'), 400);
    $stmt = $pdo->prepare('SELECT id,key_prefix,key_hash,key_ciphertext FROM subscription_keys WHERE id=? LIMIT 1');
    $stmt->execute(array($keyId));
    $keyRow = $stmt->fetch();
    if (!$keyRow) respond(false, array('error' => 'key_not_found', 'message' => 'Этот ключ уже отсутствует в базе.'), 404);
    $prefix = (string)$keyRow['key_prefix'];
    if ($prefix === 'DEMO-30-DAYS') respond(true, array('full_key' => 'DEMO-30-DAYS-A1B2'), 200);
    if ($prefix === 'DEMO-7-DAYS') respond(true, array('full_key' => 'DEMO-7-DAYS-C3D4'), 200);
    $ciphertext = isset($keyRow['key_ciphertext']) ? trim((string)$keyRow['key_ciphertext']) : '';
    if ($ciphertext === '') respond(false, array('error' => 'key_legacy_unrecoverable', 'message' => 'Полный код этого старого ключа не сохранялся. Его нельзя восстановить — создайте новый ключ.'), 409);
    $fullKey = decrypt_subscription_key($ciphertext, $config);
    $usedLegacyKey = false;
    if ($fullKey === null) {
        $fullKey = decrypt_subscription_key($ciphertext, $config, true);
        $usedLegacyKey = $fullKey !== null;
    }
    if ($fullKey !== null && !empty($keyRow['key_hash']) && !hash_equals((string)$keyRow['key_hash'], hash('sha256', $fullKey))) $fullKey = null;
    if ($fullKey === null) respond(false, array('error' => 'key_decryption_failed', 'message' => 'Не удалось расшифровать и проверить ключ по хешу. Проверьте, что KEY_ENCRYPTION_SECRET не менялся и данные ключа не повреждены.'), 409);
    if ($usedLegacyKey && !empty($config['key_encryption_secret'])) {
        try {
            $newCiphertext = encrypt_subscription_key($fullKey, $config);
            $rewrap = $pdo->prepare('UPDATE subscription_keys SET key_ciphertext=? WHERE id=? AND key_ciphertext=?');
            $rewrap->execute(array($newCiphertext, $keyId, $ciphertext));
        } catch (Exception $migrationError) {
            error_log('Basalt activation-key re-encryption failed for row ' . $keyId . ': ' . $migrationError->getMessage());
        }
    }
    respond(true, array('full_key' => $fullKey), 200);
}
if ($action === 'set_price_multiplier') {
    require_seller_or_admin($auth); require_active_subscription($tgId);
    if ($auth['role'] === 'buyer') respond(false,array('error'=>'role_forbidden'),403);
    $multiplier = isset($input['multiplier']) ? (float)$input['multiplier'] : 1.0;
    if (!is_finite($multiplier) || $multiplier < 0.1 || $multiplier > 100) respond(false,array('error'=>'invalid_price_multiplier','message'=>'Множитель должен быть от 0.1 до 100.'),400);
    $multiplier = round($multiplier,2);
    $pdo->beginTransaction();
    try {
        $pdo->prepare('UPDATE users SET price_multiplier=? WHERE tg_id=?')->execute(array($multiplier,$tgId));
        $st=$pdo->prepare('UPDATE products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id SET p.price_multiplier=? WHERE pl.owner_tg_id=?'); $st->execute(array($multiplier,$tgId));
        $pdo->commit();
    } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
    respond(true,array('multiplier'=>$multiplier,'updated_products'=>$st->rowCount()),200);
}
/* User detail/update actions used by the admin panel. */
    if ($action === 'admin_delete_user') {
        admin_required($auth);
        $target = isset($input['user_id']) ? (int)$input['user_id'] : 0;
        if ($target < 1) respond(false, array('error'=>'invalid_user_id','message'=>'Некорректный ID пользователя.'), 400);
        if ($target === (int)$tgId) respond(false, array('error'=>'cannot_delete_self','message'=>'Нельзя удалить собственный аккаунт администратора.'), 409);
        $stmt = $pdo->prepare("SELECT u.role,u.photo_url, EXISTS(SELECT 1 FROM admins a WHERE a.tg_id=u.tg_id) AS db_is_admin FROM users u WHERE u.tg_id=? LIMIT 1");
        $stmt->execute(array($target)); $row = $stmt->fetch();
        if (!$row) respond(false, array('error'=>'user_not_found','message'=>'Пользователь уже удалён или не найден.'), 404);
        $avatarUrl = isset($row['photo_url']) ? (string)$row['photo_url'] : '';
        $adminIds = array_filter(array_map('trim', explode(',', (string)($config['admin_ids'] ?? ''))));
        if (in_array((string)$target, $adminIds, true) || !empty($row['db_is_admin']) || (string)$row['role'] === 'admin') {
            respond(false, array('error'=>'cannot_delete_admin','message'=>'Удаление аккаунтов администраторов запрещено.'), 409);
        }
        // Older live databases may not have received every helper-table migration.
        // Create the tables this action requires before opening the transaction.
        ensure_admin_user_deletion_queue($pdo);
        ensure_user_favorites_table($pdo);
        ensure_telegram_notification_queue($pdo);
        $hasMessageCleanup = database_table_exists($pdo, 'telegram_message_cleanup');
        $pdo->beginTransaction();
        try {
            // Queue must be inserted first and intentionally has no FK to users.
            $queue = $pdo->prepare("INSERT INTO admin_user_deletion_queue (tg_id, requested_by_tg_id, status) VALUES (?, ?, 'pending')");
            $queue->execute(array($target, (int)$tgId));
            $queueId = (int)$pdo->lastInsertId();
            // Favourites have no FK, so remove both the user's own list and references to their products.
            $pdo->prepare('DELETE f FROM user_favorites f LEFT JOIN products p ON p.id=f.product_id LEFT JOIN source_rows sr ON sr.id=p.source_row_id LEFT JOIN price_lists pl ON pl.id=sr.price_list_id WHERE f.user_tg_id=? OR pl.owner_tg_id=?')->execute(array($target, $target));
            $pdo->prepare('DELETE FROM telegram_notification_queue WHERE chat_id=?')->execute(array($target));
            // This bot-side queue is optional on older installations; deletion must not fail if absent.
            if ($hasMessageCleanup) $pdo->prepare('DELETE FROM telegram_message_cleanup WHERE chat_id=?')->execute(array($target));
            $pdo->prepare('UPDATE subscription_keys SET owner_tg_id=NULL WHERE owner_tg_id=? AND used_by_tg_id IS NOT NULL AND used_by_tg_id<>?')->execute(array($target, $target));
            $pdo->prepare('DELETE FROM subscription_keys WHERE used_by_tg_id=? OR owner_tg_id=?')->execute(array($target, $target));
            // Cascades remove products/source rows, settings, notifications, parse errors and admin metadata.
            $pdo->prepare('DELETE FROM price_lists WHERE owner_tg_id=?')->execute(array($target));
            $pdo->prepare('DELETE FROM users WHERE tg_id=?')->execute(array($target));
            $log = $pdo->prepare('INSERT INTO admin_logs(admin_tg_id, action, details) VALUES(?,?,?)');
            $log->execute(array((int)$tgId, 'admin_delete_user', 'target='.$target.' queue_id='.$queueId));
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
        // Cached avatars are named per Telegram user; remove only if no surviving profile references this URL.
        if (avatar_url_is_local($avatarUrl)) {
            try {
                $avatarRef = $pdo->prepare('SELECT COUNT(*) FROM users WHERE photo_url=?');
                $avatarRef->execute(array($avatarUrl));
                if ((int)$avatarRef->fetchColumn() === 0) {
                    $avatarPath = BP_PUBLIC_ROOT . $avatarUrl;
                    $avatarRoot = realpath(BP_PUBLIC_ROOT . '/uploads/avatars');
                    $avatarParent = realpath(dirname($avatarPath));
                    $avatarInsideRoot = $avatarRoot !== false && $avatarParent !== false
                        && strpos($avatarParent, $avatarRoot . DIRECTORY_SEPARATOR) === 0
                        && preg_match('/^[a-f0-9]{64}$/i', basename($avatarParent));
                    if ($avatarInsideRoot && is_file($avatarPath)) {
                        @unlink($avatarPath);
                        if (count(@scandir($avatarParent) ?: array()) <= 2) @rmdir($avatarParent);
                    } elseif ($avatarRoot !== false && $avatarParent === $avatarRoot && is_file($avatarPath)) {
                        @unlink($avatarPath);
                    }
                }
            } catch (Throwable $ignore) {}
        }
        respond(true, array('deleted'=>true, 'user_id'=>$target, 'bot_cleanup_queued'=>true), 200);
    }
    if ($action === 'admin_user_details') {
        admin_required($auth);
        $target=isset($input['user_id'])?(int)$input['user_id']:0;
        if ($target<1) respond(false,array('error'=>'invalid_user_id'),400);
        $st=$pdo->prepare('SELECT u.tg_id,u.username,u.first_name,u.last_name,u.photo_url,u.role,u.price_multiplier,u.is_blocked,u.banned_until,u.ban_reason,u.ban_details,u.created_at,EXISTS(SELECT 1 FROM admins a WHERE a.tg_id=u.tg_id) AS db_is_admin FROM users u WHERE u.tg_id=? LIMIT 1'); $st->execute(array($target)); $userRow=$st->fetch();
        if (!$userRow) respond(false,array('error'=>'user_not_found'),404);
        $configuredAdmin=in_array((string)$target,array_filter(array_map('trim',explode(',',(string)($config['admin_ids']??'')))),true); $targetIsAdmin=($target===$tgId || $configuredAdmin || !empty($userRow['db_is_admin']) || (string)$userRow['role']==='admin'); $userRow['is_admin']=$targetIsAdmin; $userRow['role'] = $targetIsAdmin ? 'admin' : (in_array((string)$userRow['role'],array('seller','buyer','none'),true)?$userRow['role']:'none'); unset($userRow['db_is_admin']);
        $userRow['full_name']=trim((string)$userRow['first_name'].' '.(string)$userRow['last_name']);
        $sub=subscription_for($target);
        $st=$pdo->prepare('SELECT pl.id,pl.filename,pl.size_bytes,pl.status,pl.imported_at,COUNT(DISTINCT sr.id) AS row_count,COUNT(DISTINCT p.id) AS product_count FROM price_lists pl LEFT JOIN source_rows sr ON sr.price_list_id=pl.id LEFT JOIN products p ON p.source_row_id=sr.id WHERE pl.owner_tg_id=? GROUP BY pl.id ORDER BY pl.imported_at DESC,pl.id DESC');$st->execute(array($target));$userRow['price_lists']=$st->fetchAll();$userRow['files_count']=count($userRow['price_lists']);
        // Admin-only read access to a user's saved products. Sellers never receive this data.
        ensure_user_favorites_table($pdo);
        $favStmt=$pdo->prepare("SELECT p.id,p.brand,p.name,p.type,p.category,p.volume_ml,p.volume_text,p.display_kind,p.size_width,p.size_height,p.size_unit,(p.price_usd*p.price_multiplier) AS price_usd,p.price_usd AS base_price,p.price_multiplier,p.currency,p.gender,p.is_tester,p.is_set,1 AS is_favorite,pl.id AS file_id,pl.filename,pl.owner_tg_id AS seller_tg_id,u.username AS seller_username,TRIM(CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,''))) AS seller_name FROM user_favorites f JOIN products p ON p.id=f.product_id JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id LEFT JOIN users u ON u.tg_id=pl.owner_tg_id WHERE f.user_tg_id=? ORDER BY pl.owner_tg_id,p.name ASC LIMIT 1000");$favStmt->execute(array($target));$userRow['favorites']=$favStmt->fetchAll();$userRow['favorites_count']=count($userRow['favorites']);
        // Reveal full plaintext codes only inside this admin-only user-details response.
        // Never expose ciphertext or full keys in public subscription/overview responses.
        $subscriptionKeysStmt=$pdo->prepare('SELECT id,key_prefix,key_hash,key_ciphertext,duration_days,activated_at,starts_at,available_until,is_frozen FROM subscription_keys WHERE used_by_tg_id=? ORDER BY starts_at ASC,activated_at ASC,id ASC');
        $subscriptionKeysStmt->execute(array($target));
        $userSubscriptionKeys=array();
        $nowTimestamp=time();
        foreach($subscriptionKeysStmt->fetchAll() as $subscriptionKeyRow){
            $startTimestamp=!empty($subscriptionKeyRow['starts_at'])?strtotime((string)$subscriptionKeyRow['starts_at']):(!empty($subscriptionKeyRow['activated_at'])?strtotime((string)$subscriptionKeyRow['activated_at']):0);
            $endTimestamp=!empty($subscriptionKeyRow['available_until'])?strtotime((string)$subscriptionKeyRow['available_until']):0;
            $isFrozen=!empty($subscriptionKeyRow['is_frozen']);
            $keyStatus=$isFrozen?'frozen':(($startTimestamp>$nowTimestamp)?'queued':(($startTimestamp<=$nowTimestamp && $endTimestamp>$nowTimestamp)?'active':'expired'));
            if($keyStatus==='expired') continue;
            $fullKey=null;
            $ciphertext=isset($subscriptionKeyRow['key_ciphertext'])?(string)$subscriptionKeyRow['key_ciphertext']:'';
            if($ciphertext!==''){
                $fullKey=decrypt_subscription_key($ciphertext,$config);
                if($fullKey===null)$fullKey=decrypt_subscription_key($ciphertext,$config,true);
                if($fullKey!==null && !empty($subscriptionKeyRow['key_hash']) && !hash_equals((string)$subscriptionKeyRow['key_hash'],hash('sha256',$fullKey)))$fullKey=null;
            }
            $userSubscriptionKeys[]=array(
                'id'=>(int)$subscriptionKeyRow['id'],
                'key_prefix'=>(string)$subscriptionKeyRow['key_prefix'],
                'full_key'=>$fullKey,
                'duration_days'=>(int)$subscriptionKeyRow['duration_days'],
                'starts_at'=>$subscriptionKeyRow['starts_at'],
                'available_until'=>$subscriptionKeyRow['available_until'],
                'status'=>$keyStatus,
            );
        }
        $userRow['subscription_keys']=$userSubscriptionKeys;
        $keyStmt=$pdo->query('SELECT id,key_prefix,duration_days,created_at FROM subscription_keys WHERE usable=1 AND used_by_tg_id IS NULL ORDER BY created_at DESC,id DESC LIMIT 100');$userRow['available_keys']=$keyStmt->fetchAll();
        respond(true,array('user'=>$userRow,'subscription'=>$sub,'subscription_keys'=>$userSubscriptionKeys,'price_lists'=>$userRow['price_lists'],'favorites'=>$userRow['favorites'],'available_keys'=>$userRow['available_keys']),200);
    }
    if ($action === 'admin_extend_user_subscription') {
        admin_required($auth);
        $target = isset($input['user_id']) ? (int)$input['user_id'] : 0;
        $amount = isset($input['amount']) ? (int)$input['amount'] : 0;
        $unit = isset($input['unit']) ? (string)$input['unit'] : 'days';
        $unitSql = array('hours' => 'HOUR', 'days' => 'DAY', 'months' => 'MONTH');
        $maxAmount = array('hours' => 8760, 'days' => 3650, 'months' => 120);
        if ($target < 1 || !isset($unitSql[$unit]) || $amount < 1 || $amount > $maxAmount[$unit]) {
            respond(false, array('error' => 'invalid_subscription_extension', 'message' => 'Проверьте количество и единицу продления.'), 400);
        }
        $targetStmt = $pdo->prepare("SELECT u.role,EXISTS(SELECT 1 FROM admins a WHERE a.tg_id=u.tg_id) AS db_is_admin FROM users u WHERE u.tg_id=? LIMIT 1");
        $targetStmt->execute(array($target));
        $targetRow = $targetStmt->fetch();
        if (!$targetRow) respond(false, array('error' => 'user_not_found'), 404);
        $configuredAdmin = in_array((string)$target, array_filter(array_map('trim', explode(',', (string)($config['admin_ids'] ?? '')))), true);
        if ($target === (int)$tgId || $configuredAdmin || !empty($targetRow['db_is_admin']) || (string)$targetRow['role'] === 'admin') {
            respond(false, array('error' => 'admin_profile_readonly', 'message' => 'Нельзя продлевать подписку из профиля администратора.'), 409);
        }
        $pdo->beginTransaction();
        try {
            // Keep the same lock order as WebApp and Telegram activation: user row first, then subscription key.
            $userLock = $pdo->prepare('SELECT tg_id FROM users WHERE tg_id=? FOR UPDATE');
            $userLock->execute(array($target));
            if (!$userLock->fetchColumn()) {
                $pdo->rollBack();
                respond(false, array('error'=>'user_not_found'), 404);
            }
            // After queued renewals exist, the newest activated_at may belong to a future key.
            // Extend only the interval that is active now, never the queued successor.
            $keyStmt = $pdo->prepare('SELECT id,available_until,is_frozen FROM subscription_keys WHERE used_by_tg_id=? AND starts_at<=NOW() AND available_until>NOW() ORDER BY starts_at DESC,id DESC LIMIT 1 FOR UPDATE');
            $keyStmt->execute(array($target));
            $keyRow = $keyStmt->fetch();
            if (!$keyRow || !empty($keyRow['is_frozen']) || !$keyRow['available_until'] || strtotime((string)$keyRow['available_until']) <= time()) {
                $pdo->rollBack();
                respond(false, array('error' => 'subscription_not_active', 'message' => 'Продлить можно только активную и не замороженную подписку.'), 409);
            }
            $sql = 'UPDATE subscription_keys SET available_until=DATE_ADD(GREATEST(available_until,NOW()), INTERVAL ' . $amount . ' ' . $unitSql[$unit] . ') WHERE id=? AND used_by_tg_id=? AND is_frozen=0 AND available_until>NOW()';
            $update = $pdo->prepare($sql);
            $update->execute(array((int)$keyRow['id'], $target));
            if ($update->rowCount() !== 1) {
                $pdo->rollBack();
                respond(false, array('error' => 'subscription_extension_failed', 'message' => 'Срок подписки не изменился. Обновите профиль и повторите.'), 409);
            }
            // Move every queued segment by the same extension interval so that no
            // queued key starts before the newly extended active period ends.
            $shiftQueueSql = 'UPDATE subscription_keys SET starts_at=DATE_ADD(starts_at, INTERVAL ' . $amount . ' ' . $unitSql[$unit] . '), available_until=DATE_ADD(available_until, INTERVAL ' . $amount . ' ' . $unitSql[$unit] . ') WHERE used_by_tg_id=? AND starts_at>=? AND available_until>starts_at AND is_frozen=0';
            $shiftQueue = $pdo->prepare($shiftQueueSql);
            $shiftQueue->execute(array($target, (string)$keyRow['available_until']));
            // Let the bot schedule reminders against the new expiry instead of stale rows.
            try { $pdo->prepare('DELETE FROM subscription_reminders WHERE subscription_key_id=?')->execute(array((int)$keyRow['id'])); } catch (Throwable $ignore) {}
            $log = $pdo->prepare('INSERT INTO admin_logs(admin_tg_id,action,details) VALUES(?,?,?)');
            $log->execute(array($tgId, 'admin_extend_user_subscription', 'target='.$target.' amount='.$amount.' unit='.$unit.' key='.(int)$keyRow['id']));
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
        respond(true, array('saved' => true, 'user_id' => $target, 'subscription' => subscription_for($target)), 200);
    }
    if ($action === 'admin_update_user') {
        admin_required($auth);
        $target=isset($input['user_id'])?(int)$input['user_id']:0;
        if ($target<1) respond(false,array('error'=>'invalid_user_id'),400);
        $st=$pdo->prepare('SELECT u.role,EXISTS(SELECT 1 FROM admins a WHERE a.tg_id=u.tg_id) AS db_is_admin FROM users u WHERE u.tg_id=?'); $st->execute(array($target)); $targetRow=$st->fetch(); if (!$targetRow) respond(false,array('error'=>'user_not_found'),404);
        $targetIsConfiguredAdmin=in_array((string)$target,array_filter(array_map('trim',explode(',',(string)($config['admin_ids']??'')))),true);
        $targetIsAdmin=($target===$tgId || $targetIsConfiguredAdmin || !empty($targetRow['db_is_admin']) || (string)$targetRow['role']==='admin');
        $role=isset($input['role'])?(string)$input['role']:'';
        if ($targetIsAdmin && (($role!=='' && $role!=='admin') || !empty($input['ban']) || !empty($input['clear_ban']))) respond(false,array('error'=>'admin_profile_readonly','message'=>'Профиль администратора защищён от смены роли и блокировки.'),409);
        if ($role!=='') {
            if (!in_array($role,array('seller','buyer','admin','none'),true)) respond(false,array('error'=>'invalid_role'),400);
            if ($targetIsAdmin) { /* The modal is read-only for administrator profiles; never write their role. */ } else {
                $pdo->prepare('UPDATE users SET role=? WHERE tg_id=?')->execute(array($role,$target));
                if ($role==='admin') $pdo->prepare('INSERT IGNORE INTO admins(tg_id) VALUES(?)')->execute(array($target));
                elseif (!$targetIsConfiguredAdmin) $pdo->prepare('DELETE FROM admins WHERE tg_id=?')->execute(array($target));
            }
        }
        if (!empty($input['clear_ban'])) {
            $pdo->prepare('UPDATE users SET is_blocked=0,banned_until=NULL,ban_reason=NULL,ban_details=NULL WHERE tg_id=?')->execute(array($target));
        } elseif (!empty($input['ban'])) {
            $permanent=!empty($input['permanent']);
            $reason=trim((string)($input['ban_reason']??''));
            $details=trim((string)($input['ban_details']??''));
            if ($reason==='') respond(false,array('error'=>'ban_reason_required','message'=>'Укажите причину блокировки.'),400);
            $until=null;
            if (!$permanent) {
                if (!empty($input['banned_until'])) {
                    $rawUntil=str_replace('T',' ',substr((string)$input['banned_until'],0,16));
                    $dt=DateTime::createFromFormat('Y-m-d H:i',$rawUntil);
                    if (!$dt || $dt->getTimestamp()<=time()) respond(false,array('error'=>'invalid_ban_until','message'=>'Дата разблокировки должна быть в будущем.'),400);
                    $until=$dt->format('Y-m-d H:i:s');
                } else {
                    $minutes=max(0,(int)($input['minutes']??0)); $hours=max(0,(int)($input['hours']??0)); $days=max(0,(int)($input['days']??0));
                    $seconds=$minutes*60+$hours*3600+$days*86400;
                    if ($seconds<60) respond(false,array('error'=>'invalid_ban_duration','message'=>'Для временной блокировки выберите срок больше нуля.'),400);
                    $until=date('Y-m-d H:i:s',time()+$seconds);
                }
            }
            $shortReason=function_exists('mb_substr')?mb_substr($reason,0,500,'UTF-8'):substr($reason,0,500);
            $pdo->prepare('UPDATE users SET is_blocked=1,banned_until=?,ban_reason=?,ban_details=? WHERE tg_id=?')->execute(array($until,$shortReason,$details,$target));
        }
        $st=$pdo->prepare('SELECT role,is_blocked,banned_until FROM users WHERE tg_id=? LIMIT 1'); $st->execute(array($target)); $finalState=$st->fetch();
        $blockedNow=$finalState && !empty($finalState['is_blocked']) && (!$finalState['banned_until'] || strtotime($finalState['banned_until'])>time());
        $langSt=$pdo->prepare('SELECT language FROM user_settings WHERE tg_id=? LIMIT 1'); $langSt->execute(array($target)); $userLanguage=(string)$langSt->fetchColumn();
        sync_telegram_menu_keyboard($target, (bool)$blockedNow, $finalState ? (string)$finalState['role'] : 'seller', $userLanguage, $config);
        $log=$pdo->prepare('INSERT INTO admin_logs(admin_tg_id,action,details) VALUES(?,?,?)'); $log->execute(array($tgId,'admin_update_user','target='.$target.' role='.$role.' ban='.(int)!empty($input['ban']).' clear='.(int)!empty($input['clear_ban'])));
        respond(true,array('saved'=>true),200);
    }
if ($action === 'admin_stats') {
    admin_required($auth);
    $stats=array();
    $stats['maintenance']=maintenance_state($pdo);
    $stats['browser_features']=browser_features($pdo);
    foreach (array('users'=>'SELECT COUNT(*) n FROM users','keys'=>'SELECT COUNT(*) n FROM subscription_keys','active_subscriptions'=>'SELECT COUNT(DISTINCT used_by_tg_id) n FROM subscription_keys WHERE used_by_tg_id IS NOT NULL AND starts_at<=NOW() AND available_until>NOW() AND is_frozen=0','price_lists'=>'SELECT COUNT(*) n FROM price_lists','products'=>'SELECT COUNT(*) n FROM products','review_rows'=>'SELECT COUNT(*) n FROM products WHERE needs_review=1') as $k=>$sql) { $stats[$k]=(int)$pdo->query($sql)->fetch()['n']; }
    $stmt=$pdo->query('SELECT id,key_prefix,key_hash,key_ciphertext,usable,duration_days,role_on_activate,used_by_tg_id,starts_at,available_until,is_frozen,CASE WHEN used_by_tg_id IS NOT NULL AND starts_at>NOW() AND available_until>NOW() AND is_frozen=0 THEN 1 ELSE 0 END AS is_queued,created_at FROM subscription_keys ORDER BY id DESC LIMIT 50'); $stats['keys_list']=$stmt->fetchAll();
    foreach ($stats['keys_list'] as &$keyRow) {
        $ciphertext = isset($keyRow['key_ciphertext']) ? trim((string)$keyRow['key_ciphertext']) : '';
        $fullKey = $ciphertext !== '' ? decrypt_subscription_key($ciphertext, $config) : null;
        $usedLegacyKey = false;
        if ($fullKey !== null && !empty($keyRow['key_hash']) && !hash_equals((string)$keyRow['key_hash'], hash('sha256', $fullKey))) $fullKey = null;
        if ($fullKey === null && $ciphertext !== '') {
            $fullKey = decrypt_subscription_key($ciphertext, $config, true);
            $usedLegacyKey = $fullKey !== null;
            if ($fullKey !== null && !empty($keyRow['key_hash']) && !hash_equals((string)$keyRow['key_hash'], hash('sha256', $fullKey))) { $fullKey = null; $usedLegacyKey = false; }
        }
        if ($usedLegacyKey && !empty($config['key_encryption_secret'])) {
            try {
                $newCiphertext = encrypt_subscription_key($fullKey, $config);
                $rewrap = $pdo->prepare('UPDATE subscription_keys SET key_ciphertext=? WHERE id=? AND key_ciphertext=?');
                $rewrap->execute(array($newCiphertext, (int)$keyRow['id'], $ciphertext));
            } catch (Exception $migrationError) {
                error_log('Basalt activation-key re-encryption failed for row ' . (int)$keyRow['id'] . ': ' . $migrationError->getMessage());
            }
        }
        // Demo credentials are intentionally available as public test examples.
        if ($fullKey === null && $keyRow['key_prefix'] === 'DEMO-30-DAYS') $fullKey = 'DEMO-30-DAYS-A1B2';
        if ($fullKey === null && $keyRow['key_prefix'] === 'DEMO-7-DAYS') $fullKey = 'DEMO-7-DAYS-C3D4';
        $keyRow['full_key'] = $fullKey;
        // Ciphertext can exist even when its encryption secret was changed or data is damaged.
        // Enable reveal/copy only when the value was actually decrypted.
        $keyRow['can_reveal'] = ($fullKey !== null);
        $keyRow['key_unavailable_reason'] = $fullKey !== null
            ? null
            : ($ciphertext === '' ? 'key_legacy_unrecoverable' : 'key_decryption_failed');
        // The admin UI only needs the revealed value, never the one-way digest or ciphertext.
        unset($keyRow['key_ciphertext'], $keyRow['key_hash']);
    }
    unset($keyRow);
    // Keep actionable keys at the top, and put damaged/unreadable ciphertext rows
    // after all readable keys. Within each group, newest keys remain first.
    usort($stats['keys_list'], function($a, $b) {
        $group = function($row) {
            $readable = !empty($row['can_reveal']);
            $used = !empty($row['used_by_tg_id']) || (isset($row['usable']) && (int)$row['usable'] === 0);
            if ($readable) return $used ? 1 : 0;
            return $used ? 3 : 2;
        };
        $diff = $group($a) - $group($b);
        if ($diff !== 0) return $diff;
        return (int)$b['id'] <=> (int)$a['id'];
    });
    $stmt=$pdo->query('SELECT u.tg_id,u.username,u.first_name,u.last_name,u.photo_url,u.role,u.price_multiplier,u.is_blocked,u.banned_until,u.ban_reason,u.ban_details,(SELECT MAX(k2.available_until) FROM subscription_keys k2 WHERE k2.used_by_tg_id=u.tg_id AND k2.is_frozen=0) AS available_until,0 AS is_frozen,EXISTS(SELECT 1 FROM admins a WHERE a.tg_id=u.tg_id) AS db_is_admin FROM users u ORDER BY u.created_at DESC LIMIT 100'); $stats['users_list']=$stmt->fetchAll();
    $configuredAdminIds=array_filter(array_map('trim',explode(',',(string)($config['admin_ids']??''))));
    foreach ($stats['users_list'] as &$userRow) {
        $userRow['role']=(!empty($userRow['db_is_admin']) || in_array((string)$userRow['tg_id'],$configuredAdminIds,true))?'admin':(in_array((string)$userRow['role'],array('buyer','seller','none'),true)?$userRow['role']:'none');
        unset($userRow['db_is_admin']);
    }
    unset($userRow);
    respond(true,$stats,200);
}
if ($action === 'save_browser_features') {
    admin_required($auth);
    $browserAccess = !empty($input['browser_access_enabled']);
    $sessionSync = array_key_exists('session_sync_enabled', $input) ? !empty($input['session_sync_enabled']) : app_setting_enabled($pdo, 'session_sync_enabled', true);
    $buyerSubscriptionRequired = array_key_exists('buyer_subscription_required', $input) ? !empty($input['buyer_subscription_required']) : app_setting_enabled($pdo, 'buyer_subscription_required', true);
    $up = $pdo->prepare('INSERT INTO app_settings(setting_key,setting_value) VALUES(?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)');
    $pdo->beginTransaction();
    try {
        $up->execute(array('browser_access_enabled',$browserAccess ? '1' : '0'));
        $up->execute(array('session_sync_enabled',$sessionSync ? '1' : '0'));
        $up->execute(array('buyer_subscription_required',$buyerSubscriptionRequired ? '1' : '0'));
        $log = $pdo->prepare('INSERT INTO admin_logs(admin_tg_id,action,details) VALUES(?,?,?)');
        $log->execute(array($tgId,'save_browser_features','browser_access='.(int)$browserAccess.';session_sync='.(int)$sessionSync.';buyer_subscription_required='.(int)$buyerSubscriptionRequired));
        $pdo->commit();
    } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
    respond(true,array('browser_features'=>browser_features($pdo)),200);
}
if ($action === 'save_maintenance') {
    admin_required($auth);
    $enabled=!empty($input['enabled']);
    $title=trim((string)($input['title']??'Технические работы'));
    $message=trim((string)($input['message']??''));
    if ($enabled && ($title==='' || $message==='')) respond(false,array('error'=>'title_and_message_required','message'=>'Заполните заголовок и подробное описание технических работ.'),400);
    $title=function_exists('mb_substr')?mb_substr($title,0,190,'UTF-8'):substr($title,0,190);
    $message=function_exists('mb_substr')?mb_substr($message,0,4000,'UTF-8'):substr($message,0,4000);
    $until=null;
    if($enabled){$raw=trim((string)($input['until']??''));$raw=str_replace('T',' ',$raw);$dt=DateTime::createFromFormat('Y-m-d H:i',$raw);if(!$dt||$dt->getTimestamp()<=time())respond(false,array('error'=>'invalid_maintenance_until','message'=>'Укажите время окончания технических работ в будущем.'),400);$until=$dt->format('Y-m-d H:i:s');}
    $pdo->beginTransaction();
    try{
        $settingsRows=array('maintenance_mode'=>$enabled?'1':'0','maintenance_title'=>$title!==''?$title:'Технические работы','maintenance_message'=>$message!==''?$message:'Сервис временно недоступен. Попробуйте позже.','maintenance_until'=>$until?:'');
        $up=$pdo->prepare('INSERT INTO app_settings(setting_key,setting_value) VALUES(?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)');
        foreach($settingsRows as $key=>$value)$up->execute(array($key,$value));
        $log=$pdo->prepare('INSERT INTO admin_logs(admin_tg_id,action,details) VALUES(?,?,?)');$log->execute(array($tgId,'save_maintenance','enabled='.(int)$enabled.' until='.($until?:'none').' title='.$title));
        $pdo->commit();
    }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
    respond(true,array('maintenance'=>maintenance_state($pdo)),200);
}
if ($action === 'admin_change_user_key') {
    admin_required($auth);
    $target=isset($input['user_id'])?(int)$input['user_id']:0;$keyId=isset($input['key_id'])?(int)$input['key_id']:0;
    if($target<1||$keyId<1)respond(false,array('error'=>'invalid_user_or_key'),400);
    $targetStmt=$pdo->prepare('SELECT u.role,EXISTS(SELECT 1 FROM admins a WHERE a.tg_id=u.tg_id) AS db_is_admin FROM users u WHERE u.tg_id=? LIMIT 1');$targetStmt->execute(array($target));$targetRow=$targetStmt->fetch();if(!$targetRow)respond(false,array('error'=>'user_not_found'),404);
    $configuredAdmin=in_array((string)$target,array_filter(array_map('trim',explode(',',(string)($config['admin_ids']??'')))),true);
    if($target===$tgId||$configuredAdmin||!empty($targetRow['db_is_admin'])||(string)$targetRow['role']==='admin')respond(false,array('error'=>'admin_profile_readonly','message'=>'Нельзя менять ключ администратора.'),409);
    $pdo->beginTransaction();
    try{
        // Serialize admin assignment with Telegram/WebApp renewals: lock target account before key.
        $targetLock=$pdo->prepare('SELECT tg_id FROM users WHERE tg_id=? FOR UPDATE');$targetLock->execute(array($target));if(!$targetLock->fetchColumn()){$pdo->rollBack();respond(false,array('error'=>'user_not_found'),404);}
        $keyStmt=$pdo->prepare('SELECT id,duration_days,usable,used_by_tg_id,role_on_activate,key_prefix FROM subscription_keys WHERE id=? FOR UPDATE');$keyStmt->execute(array($keyId));$keyRow=$keyStmt->fetch();
        if(!$keyRow||empty($keyRow['usable'])||!empty($keyRow['used_by_tg_id'])){ $pdo->rollBack(); respond(false,array('error'=>'key_not_available','message'=>'Ключ уже использован или недоступен.'),409); }
        $pdo->prepare('UPDATE subscription_keys SET available_until=NOW(),is_frozen=0,frozen_at=NULL,frozen_remaining_sec=NULL WHERE used_by_tg_id=? AND available_until>NOW() AND is_frozen=0')->execute(array($target));
        $assign=$pdo->prepare('UPDATE subscription_keys SET usable=0,used_by_tg_id=?,activated_at=NOW(),starts_at=NOW(),available_until=DATE_ADD(NOW(),INTERVAL duration_days DAY),is_frozen=0,frozen_at=NULL,frozen_remaining_sec=NULL WHERE id=? AND usable=1 AND used_by_tg_id IS NULL');$assign->execute(array($target,$keyId));
        if($assign->rowCount()!==1){$pdo->rollBack();respond(false,array('error'=>'key_not_available','message'=>'Не удалось назначить ключ. Обновите список и повторите.'),409);}
        $prefix=(string)($keyRow['key_prefix']??'');$newRole='';if(preg_match('/(?:^|[-_])SELLER(?:[-_]|$)/i',$prefix))$newRole='seller';elseif(preg_match('/(?:^|[-_])BUYER(?:[-_]|$)/i',$prefix))$newRole='buyer';elseif(preg_match('/(?:^|[-_])ADMIN(?:[-_]|$)/i',$prefix))$newRole='admin';if($newRole===''){$newRole=strtolower(trim((string)($keyRow['role_on_activate']??'')));if(!in_array($newRole,array('buyer','seller','admin'),true))$newRole='buyer';}$pdo->prepare('UPDATE users SET role=? WHERE tg_id=?')->execute(array($newRole,$target));if($newRole==='admin')$pdo->prepare('INSERT IGNORE INTO admins(tg_id) VALUES(?)')->execute(array($target));else $pdo->prepare('DELETE FROM admins WHERE tg_id=?')->execute(array($target));$log=$pdo->prepare('INSERT INTO admin_logs(admin_tg_id,action,details) VALUES(?,?,?)');$log->execute(array($tgId,'admin_change_user_key','target='.$target.' key='.$keyId.' role='.$newRole));$pdo->commit();
    }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
    // Keep the Telegram reply keyboard in sync with the role written by the WebApp.
    $stateStmt=$pdo->prepare("SELECT u.is_blocked,u.banned_until,COALESCE(s.language,'ru') AS language FROM users u LEFT JOIN user_settings s ON s.tg_id=u.tg_id WHERE u.tg_id=? LIMIT 1");$stateStmt->execute(array($target));$state=$stateStmt->fetch();$blockedNow=$state&&!empty($state['is_blocked'])&&(!$state['banned_until']||strtotime((string)$state['banned_until'])>time());sync_telegram_menu_keyboard($target,(bool)$blockedNow,$newRole,$state?(string)$state['language']:'ru',$config);
    respond(true,array('saved'=>true,'user_id'=>$target,'key_id'=>$keyId,'role'=>$newRole),200);
}
if ($action === 'generate_keys') {
    admin_required($auth);
    $count=isset($input['count'])?max(1,min(100,(int)$input['count'])):10;
    $days=isset($input['days'])?max(1,min(3650,(int)$input['days'])):30;
    $roleOnActivate=isset($input['role_on_activate'])?strtolower(trim((string)$input['role_on_activate'])):'buyer';
    if (!in_array($roleOnActivate,array('buyer','seller','admin'),true)) respond(false,array('error'=>'invalid_activation_role','message'=>'Выберите роль ключа: покупатель, продавец или администратор.'),400);
    $keys=array();
    for($i=0;$i<$count;$i++){
        $raw='BP-'.random_subscription_key_group().'-'.random_subscription_key_group().'-'.random_subscription_key_group().'-'.random_subscription_key_group();
        $prefix=substr($raw,0,7);$cipher=encrypt_subscription_key($raw,$config);
        $stmt=$pdo->prepare('INSERT INTO subscription_keys(key_hash,key_prefix,key_ciphertext,usable,duration_days,role_on_activate) VALUES(?,?,?,1,?,?)');
        $stmt->execute(array(hash('sha256',$raw),$prefix,$cipher,$days,$roleOnActivate));$keys[]=$raw;
    }
    $stmt=$pdo->prepare('INSERT INTO admin_logs(admin_tg_id,action,details) VALUES(?,?,?)');
    $stmt->execute(array($tgId,'generate_keys','count='.$count.' days='.$days.' role='.$roleOnActivate));
    respond(true,array('keys'=>$keys,'count'=>$count,'days'=>$days,'role_on_activate'=>$roleOnActivate),200);
}
if ($action === 'create_announcement') {
    admin_required($auth);
    $title = trim(isset($input['title']) ? (string)$input['title'] : '');
    $message = trim(isset($input['message']) ? (string)$input['message'] : '');
    if ($title === '' || $message === '') respond(false,array('error'=>'title_and_message_required'),400);
    $title = function_exists('mb_substr') ? mb_substr($title,0,190,'UTF-8') : substr($title,0,190);
    $message = function_exists('mb_substr') ? mb_substr($message,0,4000,'UTF-8') : substr($message,0,4000);
    // The queue is intentionally durable: the admin request only writes DB rows;
    // Telegram delivery is handled by the running bot worker, not by this HTTP request.
    ensure_telegram_notification_queue($pdo);
    $stmt = $pdo->query('SELECT u.tg_id FROM users u LEFT JOIN user_settings s ON s.tg_id=u.tg_id WHERE COALESCE(s.notify_updates,1)=1');
    $targets = $stmt->fetchAll(PDO::FETCH_COLUMN);
    $insert = $pdo->prepare("INSERT INTO app_notifications(tg_id,kind,title,body) VALUES(?,'update',?,?)");
    $queueInsert = $pdo->prepare("INSERT INTO telegram_notification_queue(notification_id,chat_id,title,body,status,available_at) VALUES(?,?,?,?, 'pending', NOW()) ON DUPLICATE KEY UPDATE title=VALUES(title),body=VALUES(body),status=IF(status='sent','sent','pending'),available_at=IF(status='sent',available_at,NOW()),last_error=NULL");
    $pdo->beginTransaction();
    $queued = 0;
    try {
        foreach ($targets as $target) {
            $targetId = (int)$target;
            $insert->execute(array($targetId,$title,$message));
            $notificationId = (int)$pdo->lastInsertId();
            $queueInsert->execute(array($notificationId,$targetId,$title,$message));
            $queued++;
        }
        $log = $pdo->prepare('INSERT INTO admin_logs(admin_tg_id,action,details) VALUES(?,?,?)');
        $log->execute(array($tgId,'create_announcement','recipients='.count($targets).' telegram_queued='.$queued.' title='.$title));
        $pdo->commit();
    } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
    respond(true,array('recipients'=>count($targets),'telegram_queued'=>$queued,'telegram_sent'=>0,'delivery'=>'queued'),200);
}
