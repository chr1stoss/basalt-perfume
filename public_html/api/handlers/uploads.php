<?php
if ($action === 'upload_price_list') {
    upload_web_price_list($pdo, $auth, $config);
}
if ($action === 'stage_price_list') {
    stage_web_price_list($pdo, $auth, $config, $input);
}
if ($action === 'request_upload_scan') {
    request_web_upload_scan($config, $auth, $input);
}
if ($action === 'upload_review_status') {
    web_upload_review_status($config, $auth, $input);
}
if ($action === 'finalize_upload_batch') {
    finalize_web_upload_batch($pdo, $config, $auth, $input);
}
if ($action === 'cancel_upload_batch') {
    cancel_web_upload_batch($config, $auth, $input);
}
if ($action === 'upload_accepted_notification') {
    require_seller_or_admin($auth);
    $names = isset($input['files']) && is_array($input['files']) ? $input['files'] : array();
    $names = array_values(array_unique(array_filter(array_map(function($name){ return safe_price_filename($name); }, $names))));
    $names = array_slice($names, 0, 20);
    if (!$names) respond(true, array('created'=>false), 200);
    $count = count($names);
    $title = 'Прайс-листы приняты';
    $body = ($count === 1 ? $names[0] : "Файлов в группе: {$count}\n" . implode("\n", array_map(function($name){ return '• ' . $name; }, $names))) . "\n\nНачинаю обработку. Результат будет в одном уведомлении.";
    $stmt = $pdo->prepare("INSERT INTO app_notifications(tg_id,kind,title,body) VALUES(?,'file_upload_accepted',?,?)");
    $stmt->execute(array((int)$auth['tg_id'], $title, $body));
    respond(true, array('created'=>true, 'count'=>$count), 201);
}
