<?php
if ($action === 'files') {
    require_seller_or_admin($auth); require_active_subscription($tgId);
    $stmt=$pdo->prepare("SELECT pl.id,pl.filename,pl.size_bytes,CASE WHEN pl.status='ready' THEN 'ready' WHEN q.status='error' THEN 'error' WHEN q.status='processing' THEN 'processing' WHEN q.status='pending' THEN 'pending' ELSE pl.status END AS status,pl.imported_at,q.attempts AS queue_attempts,CASE WHEN q.status='error' THEN 'Не удалось обработать файл. Технические сведения сохранены в журнале.' ELSE NULL END AS queue_error,TIMESTAMPDIFF(SECOND,q.created_at,NOW()) AS queue_wait_seconds,TIMESTAMPDIFF(SECOND,q.locked_at,NOW()) AS queue_heartbeat_age,COUNT(DISTINCT p.id) AS product_count,COALESCE(SUM(p.needs_review),0) AS review_count FROM price_lists pl LEFT JOIN web_upload_site_jobs q ON q.price_list_id=pl.id LEFT JOIN source_rows sr ON sr.price_list_id=pl.id LEFT JOIN products p ON p.source_row_id=sr.id WHERE pl.owner_tg_id=? GROUP BY pl.id,q.status,q.attempts,q.locked_at,q.created_at ORDER BY pl.imported_at DESC");
    $stmt->execute(array($tgId)); respond(true,$stmt->fetchAll(),200);
}
if ($action === 'delete_file') {
    require_seller_or_admin($auth); require_active_subscription($tgId);
    $fileId = isset($input['file_id']) ? (int)$input['file_id'] : 0;
    $targetOwner = (!empty($auth['is_admin']) && isset($input['user_id'])) ? (int)$input['user_id'] : (int)$tgId;
    if ($targetOwner < 1) respond(false,array('error'=>'invalid_user_id'),400);

    // Keep favorite cleanup and catalogue deletion atomic. The favorites table has
    // no product FK, so MySQL cannot remove these rows through the price-list cascade.
    ensure_user_favorites_table($pdo);
    $storedPath = '';
    $notificationId = 0;
    $pdo->beginTransaction();
    try {
        $stmt=$pdo->prepare('SELECT filepath FROM price_lists WHERE id=? AND owner_tg_id=? FOR UPDATE');
        $stmt->execute(array($fileId,$targetOwner));
        $f=$stmt->fetch();
        if (!$f) {
            $pdo->rollBack();
            respond(false,array('error'=>'file_not_found'),404);
        }
        $storedPath = (string)($f['filepath'] ?? '');

        $deleteFavorites = $pdo->prepare('DELETE f FROM user_favorites f INNER JOIN products p ON p.id=f.product_id INNER JOIN source_rows sr ON sr.id=p.source_row_id WHERE sr.price_list_id=?');
        $deleteFavorites->execute(array($fileId));

        $deleteList = $pdo->prepare('DELETE FROM price_lists WHERE id=? AND owner_tg_id=?');
        $deleteList->execute(array($fileId,$targetOwner));
        if ($deleteList->rowCount() !== 1) throw new RuntimeException('Price list could not be deleted');

        $notify = $pdo->prepare('INSERT INTO app_notifications(tg_id,kind,title,body) VALUES(?,\'system\',\'Прайс-лист удалён\',\'Запись прайс-листа удалена из каталога.\')');
        $notify->execute(array($targetOwner));
        $notificationId = (int)$pdo->lastInsertId();
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    // Remove the private file only after the DB transaction commits successfully.
    if ($storedPath !== '') {
        $deletePath = realpath($storedPath);
        $deleteRoots = array();
        $newDeleteRoot = realpath(configured_web_upload_storage_dir($config));
        if ($newDeleteRoot !== false) $deleteRoots[] = rtrim($newDeleteRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
        if (!empty($config['price_list_storage_dir'])) {
            $legacyDeleteRoot = realpath((string)$config['price_list_storage_dir']);
            if ($legacyDeleteRoot !== false) $deleteRoots[] = rtrim($legacyDeleteRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
        }
        $deleteAllowed = false;
        if ($deletePath !== false) foreach ($deleteRoots as $deleteRoot) {
            if (strpos($deletePath, $deleteRoot) === 0) { $deleteAllowed = true; break; }
        }
        if ($deleteAllowed && is_link($storedPath)) {
            $linkParent = realpath(dirname($storedPath));
            $parentAllowed = false;
            if ($linkParent !== false) foreach ($deleteRoots as $deleteRoot) {
                if (strpos(rtrim($linkParent, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR, $deleteRoot) === 0) { $parentAllowed = true; break; }
            }
            if ($parentAllowed) @unlink($storedPath);
        } elseif ($deleteAllowed && is_file($deletePath)) {
            @unlink($deletePath);
        }
    }
    send_telegram_photo_notification($config, $targetOwner, 'Прайс-лист удалён', 'Запись прайс-листа удалена из каталога.', $notificationId);
    respond(true,array('deleted'=>true),200);
}
