<?php
/* First-open Telegram avatar cache. Runs as a separate, non-critical API action. */
    if ($action === 'cache_avatar') {
        $sourcePhoto = isset($auth['user']['photo_url']) ? (string)$auth['user']['photo_url'] : '';
        $st=$pdo->prepare('SELECT photo_url FROM users WHERE tg_id=? LIMIT 1'); $st->execute(array($tgId)); $storedPhoto=(string)$st->fetchColumn();
        if (avatar_url_is_local($storedPhoto) && is_file(dirname(__DIR__) . $storedPhoto)) respond(true,array('photo_url'=>$storedPhoto,'cached'=>true),200);
        $cachedUrl = $sourcePhoto !== '' ? cache_telegram_avatar_from_url($tgId,$sourcePhoto) : null;
        if (!$cachedUrl) $cachedUrl = cache_telegram_avatar_from_bot_api($tgId,$config);
        if ($cachedUrl) { $pdo->prepare('UPDATE users SET photo_url=? WHERE tg_id=?')->execute(array($cachedUrl,$tgId)); respond(true,array('photo_url'=>$cachedUrl,'cached'=>true),200); }
        respond(true,array('cached'=>false),200);
    }
?>
