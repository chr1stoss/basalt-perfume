<?php
try {
    $requestMethod = strtoupper(isset($_SERVER['REQUEST_METHOD']) ? (string)$_SERVER['REQUEST_METHOD'] : '');
    if (($requestMethod === 'GET' || $requestMethod === 'OPTIONS') && isset($_GET['download_token'])) {
        header('Access-Control-Allow-Origin: https://web.telegram.org');
        header('Access-Control-Allow-Methods: GET, OPTIONS');
        header('Access-Control-Expose-Headers: Content-Disposition, Content-Length');
        header('Access-Control-Max-Age: 300');
        header('Vary: Origin');
        header('Cross-Origin-Resource-Policy: cross-origin');
        if ($requestMethod === 'OPTIONS') { http_response_code(204); exit; }
        $downloadPdo = db();
        serve_signed_web_download($downloadPdo, $config, (string)$_GET['download_token']);
    }
    if ($requestMethod !== 'POST') {
        header('Allow: POST');
        http_response_code(405);
        echo json_encode(array('ok'=>false,'data'=>array('error'=>'method_not_allowed','message'=>'API принимает только POST-запросы.','http_status'=>405)), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }
    $input = body_data();
    $action = isset($input['action']) ? (string)$input['action'] : '';
    if ($action === '') respond(false, array('error'=>'action_required','message'=>'Не указано действие API.'), 400);
    require __DIR__ . '/handlers/browser_logout.php';
    $pdo = db();
    require __DIR__ . '/handlers/browser_auth.php';
    $auth = current_user($input);
    $tgId = $auth['tg_id'];
    // These two actions are read-only status polling started by an explicit upload or
    // the open Prices page. They must not act as hidden heartbeat/session-pulse calls.
    $backgroundStatusPoll = in_array($action, array('files','upload_review_status'), true);
    // Enforce system maintenance and bans on page loads and real user actions.
    // A status poll is deliberately excluded; the next explicit action is guarded.
    if (!$backgroundStatusPoll) enforce_account_locks($auth, $tgId, $action, $pdo);
    // Session synchronization is event-driven. Do not refresh the lock from background polls.
    if (!$backgroundStatusPoll && $action !== 'session_sync' && isset($input['client_id'])) {
        $sync = session_sync_state($pdo, $tgId, array(
            'mode' => 'activity',
            'client_id' => (string)$input['client_id'],
            'platform' => isset($input['platform']) ? (string)$input['platform'] : 'mobile'
        ));
        if (!empty($sync['enabled']) && empty($sync['active'])) {
            respond(false, array(
                'error' => 'session_inactive',
                'message' => 'Приложение активно в другой сессии. Продолжите работу здесь, чтобы переключить её.',
                'owner_platform' => isset($sync['owner_platform']) ? $sync['owner_platform'] : null
            ), 409);
        }
    }
    // Users without a role or active subscription may only read the minimum account
    // overview needed to render the subscription gate. Do not expose catalogue/settings APIs.
    if (empty($auth['is_admin']) && !in_array($action, array('overview','me','cache_avatar','activate_subscription_key','session_sync'), true)) {
        $gateSubscription = subscription_for($tgId);
        if ($auth['role'] === 'none' || !$gateSubscription || empty($gateSubscription['active'])) {
            respond(false, array('error'=>'subscription_required','message'=>'Для доступа к приложению купите или продлите подписку в Telegram-боте.'), 403);
        }
    }
    require __DIR__ . '/handlers/session.php';
    require __DIR__ . '/handlers/account.php';
    require __DIR__ . '/handlers/uploads.php';
    require __DIR__ . '/handlers/downloads.php';
    require __DIR__ . '/handlers/price_lists.php';
    require __DIR__ . '/handlers/catalog.php';
    require __DIR__ . '/handlers/favorites.php';
    require __DIR__ . '/handlers/notifications.php';
    require __DIR__ . '/handlers/settings.php';
    require __DIR__ . '/handlers/admin.php';
    respond(false,array('error'=>'unknown_action'),400);
} catch (Throwable $e) {
    error_log('Basalt API error: '.$e->getMessage());
    respond(false,array('error'=>'server_error','message'=>'Ошибка сервера. Проверьте конфигурацию и схему базы данных.'),500);
}
