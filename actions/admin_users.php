<?php
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
                    $avatarPath = __DIR__ . $avatarUrl;
                    $avatarRoot = realpath(__DIR__ . '/uploads/avatars');
                    $avatarParent = realpath(dirname($avatarPath));
                    if ($avatarRoot !== false && $avatarParent === $avatarRoot && is_file($avatarPath)) @unlink($avatarPath);
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
        $keyStmt=$pdo->query('SELECT id,key_prefix,duration_days,created_at FROM subscription_keys WHERE usable=1 AND used_by_tg_id IS NULL ORDER BY created_at DESC,id DESC LIMIT 100');$userRow['available_keys']=$keyStmt->fetchAll();
        respond(true,array('user'=>$userRow,'subscription'=>$sub,'price_lists'=>$userRow['price_lists'],'favorites'=>$userRow['favorites'],'available_keys'=>$userRow['available_keys']),200);
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
            $keyStmt = $pdo->prepare('SELECT id,available_until,is_frozen FROM subscription_keys WHERE used_by_tg_id=? ORDER BY activated_at DESC,id DESC LIMIT 1 FOR UPDATE');
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
?>
