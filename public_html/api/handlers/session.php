<?php
if ($action === 'session_sync') {
    $sync = session_sync_state($pdo, $tgId, $input);
    respond(true, $sync, 200);
}
if ($action === 'activate_subscription_key') {
    $key = trim((string)($input['key'] ?? ''));
    if (strlen($key) < 8 || strlen($key) > 100) respond(false, array('error'=>'invalid_subscription_key','message'=>'Проверьте ключ: допустимая длина — от 8 до 100 символов.'), 400);
    $digest = hash('sha256', $key);
    $adminIds = array_filter(array_map('trim', explode(',', (string)($config['admin_ids'] ?? ''))));
    $isLifetimeKey = stripos($key, 'ADMIN-LIFETIME-') === 0;
    if ($isLifetimeKey && !in_array((string)$tgId, $adminIds, true)) respond(false, array('error'=>'invalid_subscription_key','message'=>'Ключ недействителен.'), 400);

    $pdo->beginTransaction();
    try {
        // Serialize activations per account before locking the one-time key.
        $userLock = $pdo->prepare('SELECT tg_id,role FROM users WHERE tg_id=? FOR UPDATE');
        $userLock->execute(array((int)$tgId));
        $lockedUser = $userLock->fetch();
        if (!$lockedUser) { $pdo->rollBack(); respond(false, array('error'=>'user_not_found','message'=>'Профиль не найден. Повторите вход через Telegram.'), 404); }

        $frozenStmt = $pdo->prepare('SELECT COUNT(*) FROM subscription_keys WHERE used_by_tg_id=? AND is_frozen=1 AND (available_until>NOW() OR frozen_remaining_sec>0)');
        $frozenStmt->execute(array((int)$tgId));
        if ((int)$frozenStmt->fetchColumn() > 0) {
            $pdo->rollBack();
            respond(false, array('error'=>'subscription_is_paused','message'=>'Продление недоступно, пока подписка заморожена. Сначала возобновите её.'), 409);
        }

        $keyStmt = $pdo->prepare('SELECT id,duration_days,usable,used_by_tg_id,owner_tg_id,role_on_activate FROM subscription_keys WHERE key_hash=? FOR UPDATE');
        $keyStmt->execute(array($digest));
        $keyRow = $keyStmt->fetch();
        if (!$keyRow || (int)$keyRow['usable'] !== 1 || $keyRow['used_by_tg_id'] !== null || ($isLifetimeKey && (int)($keyRow['owner_tg_id'] ?? 0) !== (int)$tgId)) {
            $pdo->rollBack();
            respond(false, array('error'=>'invalid_subscription_key','message'=>'Ключ недействителен, уже активирован или больше недоступен.'), 400);
        }
        $activeStmt = $pdo->prepare('SELECT MAX(available_until), (MAX(available_until)>NOW()) AS will_queue FROM subscription_keys WHERE used_by_tg_id=? AND available_until>NOW() AND is_frozen=0');
        $activeStmt->execute(array((int)$tgId));
        $activeRow = $activeStmt->fetch(PDO::FETCH_NUM);
        $activeUntil = $activeRow ? $activeRow[0] : null;
        $willQueue = $activeRow && (int)$activeRow[1] === 1;
        if ($activeUntil && strpos((string)$activeUntil, '9999-12-31') === 0) {
            $pdo->rollBack();
            respond(false, array('error'=>'lifetime_subscription_active','message'=>'У вас уже действует бессрочная подписка. Добавлять ключи в очередь после неё нельзя.'), 409);
        }
        $days = (int)$keyRow['duration_days'];
        if ($days >= 365000) {
            $update = $pdo->prepare("UPDATE subscription_keys SET used_by_tg_id=?,usable=0,activated_at=NOW(),starts_at=GREATEST(COALESCE(?,NOW()),NOW()),available_until='9999-12-31 23:59:59' WHERE id=? AND usable=1 AND used_by_tg_id IS NULL");
            $update->execute(array((int)$tgId,$activeUntil ?: null,(int)$keyRow['id']));
        } else {
            $update = $pdo->prepare('UPDATE subscription_keys SET used_by_tg_id=?,usable=0,activated_at=NOW(),starts_at=GREATEST(COALESCE(?,NOW()),NOW()),available_until=DATE_ADD(GREATEST(COALESCE(?,NOW()),NOW()),INTERVAL duration_days DAY) WHERE id=? AND usable=1 AND used_by_tg_id IS NULL');
            $update->execute(array((int)$tgId,$activeUntil ?: null,$activeUntil ?: null,(int)$keyRow['id']));
        }
        if ($update->rowCount() !== 1) {
            $pdo->rollBack();
            respond(false, array('error'=>'invalid_subscription_key','message'=>'Ключ уже был активирован другим запросом.'), 409);
        }
        $targetRole = strtolower(trim((string)($keyRow['role_on_activate'] ?? '')));
        if (!$willQueue && in_array($targetRole, array('buyer','seller','admin'), true) && strtolower(trim((string)($lockedUser['role'] ?? 'none'))) === 'none') {
            $pdo->prepare('UPDATE users SET role=? WHERE tg_id=?')->execute(array($targetRole,(int)$tgId));
            if ($targetRole === 'admin') $pdo->prepare('INSERT IGNORE INTO admins(tg_id) VALUES(?)')->execute(array((int)$tgId));
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    $updatedSubscription = subscription_for($tgId);
    $roleRefresh = $pdo->prepare('SELECT role FROM users WHERE tg_id=? LIMIT 1');
    $roleRefresh->execute(array((int)$tgId));
    respond(true, array('activated'=>true,'queued'=>!empty($updatedSubscription['queued']),'subscription'=>$updatedSubscription,'role'=>(string)($roleRefresh->fetchColumn() ?: $auth['role'])), 200);
}
