<?php
/* Telegram WebApp API, compatible with PHP 7.1. */
/* Keep warnings/fatal errors from leaking HTML into a JSON response. */
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);
if (ob_get_level() === 0) { ob_start(); }
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');

function api_fallback_json($errorCode, $message, $status) {
    while (ob_get_level() > 0) { @ob_end_clean(); }
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        header('X-Content-Type-Options: nosniff');
        http_response_code($status);
    }
    /* Keep the HTTP response at 200 for API exceptions: Apache 2.2 ErrorDocument
       can replace 4xx/5xx bodies with HTML, which breaks Telegram WebApp JSON parsing.
       The intended error status is carried in data.http_status. */
    $payload = array('ok' => false, 'data' => array('error' => $errorCode, 'message' => $message, 'http_status' => (int)$status));
    if (!headers_sent()) { http_response_code(200); }
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) { $json = '{"ok":false,"data":{"error":"server_error","message":"Internal server error"}}'; }
    echo $json;
}
set_exception_handler(function ($e) {
    error_log('Basalt WebApp uncaught exception: ' . get_class($e) . ': ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    $code = ($e instanceof PDOException) ? 'database_error' : 'server_error';
    $message = ($e instanceof PDOException)
        ? 'Не удалось подключиться к базе данных или выполнить запрос. Проверьте доступ и журнал PHP.'
        : 'Ошибка сервера при обработке запроса. Подробности находятся в журнале PHP.';
    if ($e instanceof PDOException) {
        $errorText = strtolower($e->getMessage());
        $sqlState = isset($e->errorInfo[0]) ? (string)$e->errorInfo[0] : (string)$e->getCode();
        $driverCode = isset($e->errorInfo[1]) ? (int)$e->errorInfo[1] : 0;
        if (in_array($sqlState, array('HYT00','HYT01'), true) || in_array($driverCode, array(1205, 2003, 2013), true) && (strpos($errorText, 'timed out') !== false || strpos($errorText, 'timeout') !== false || strpos($errorText, 'timed out') !== false)) {
            $code = 'database_timeout';
            $message = 'Истекло время ожидания ответа базы данных. Перезагрузите WebApp и попробуйте ещё раз.';
        }
    }
    api_fallback_json($code, $message, 500);
});
register_shutdown_function(function () {
    $last = error_get_last();
    if ($last && in_array($last['type'], array(E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR), true)) {
        error_log('Basalt WebApp fatal error: ' . $last['message'] . ' in ' . $last['file'] . ':' . $last['line']);
        api_fallback_json('fatal_error', 'PHP завершил обработку запроса с ошибкой. Проверьте журнал ошибок хостинга.', 500);
    }
});
set_error_handler(function ($severity, $message, $file, $line) {
    if (!(error_reporting() & $severity)) { return false; }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

// PHP hosting usually does not read the Python project's .env automatically. Load only
// KEY_ENCRYPTION_SECRET from the parent project directory before database.php is evaluated.
// The .env file stays outside the web root; never echo its contents or put it in an archive.
if (!getenv('KEY_ENCRYPTION_SECRET')) {
    $privateEnvPath = dirname(__DIR__) . DIRECTORY_SEPARATOR . '.env';
    if (is_file($privateEnvPath) && is_readable($privateEnvPath)) {
        $lines = @file($privateEnvPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if (is_array($lines)) foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#' || strpos($line, '=') === false) continue;
            list($name, $value) = explode('=', $line, 2);
            if (trim($name) !== 'KEY_ENCRYPTION_SECRET') continue;
            $value = trim($value);
            if (strlen($value) >= 2 && (($value[0] === '"' && substr($value, -1) === '"') || ($value[0] === "'" && substr($value, -1) === "'"))) $value = substr($value, 1, -1);
            if ($value !== '') { putenv('KEY_ENCRYPTION_SECRET=' . $value); $_ENV['KEY_ENCRYPTION_SECRET'] = $value; $_SERVER['KEY_ENCRYPTION_SECRET'] = $value; }
            break;
        }
    }
}
$config = require __DIR__ . '/config/database.php';
$envKeyEncryptionSecret = getenv('KEY_ENCRYPTION_SECRET');
if ($envKeyEncryptionSecret !== false && trim((string)$envKeyEncryptionSecret) !== '') { $config['key_encryption_secret'] = trim((string)$envKeyEncryptionSecret); }
if (!isset($config['key_encryption_secret'])) { $config['key_encryption_secret'] = ''; }
function respond($ok, $data, $status) {
    /* For API errors use HTTP 200 plus JSON status metadata. The site .htaccess has
       ErrorDocument handlers for 401/403/404/500; Apache 2.2 may replace their bodies. */
    if (!$ok) {
        if (!is_array($data)) { $data = array('message' => (string)$data); }
        $data['http_status'] = (int)$status;
        http_response_code(200);
    } else {
        http_response_code($status);
    }
    $json = json_encode(array('ok' => (bool)$ok, 'data' => $data), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        http_response_code(200);
        echo '{"ok":false,"data":{"error":"json_encode_failed","message":"API could not serialize response","http_status":500}}';
    } else {
        echo $json;
    }
    exit;
}
function db() {
    global $config;
    static $pdo = null;
    if ($pdo !== null) return $pdo;
    $dsn = 'mysql:host=' . $config['db_host'] . ';port=' . $config['db_port'] . ';dbname=' . $config['db_name'] . ';charset=utf8mb4';
    $pdo = new PDO($dsn, $config['db_user'], $config['db_pass'], array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false, PDO::ATTR_TIMEOUT => 8));
    return $pdo;
}
function ensure_user_favorites_table($pdo) {
    $pdo->exec("CREATE TABLE IF NOT EXISTS user_favorites (user_tg_id BIGINT NOT NULL, product_id BIGINT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_tg_id, product_id), KEY idx_user_favorites_product (product_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}
function ensure_telegram_notification_queue($pdo) {
    $pdo->exec("CREATE TABLE IF NOT EXISTS telegram_notification_queue (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        notification_id BIGINT NOT NULL,
        chat_id BIGINT NOT NULL,
        title VARCHAR(190) NOT NULL,
        body TEXT NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
        available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        locked_at DATETIME NULL,
        sent_at DATETIME NULL,
        last_error VARCHAR(500) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_tg_notification_chat (notification_id, chat_id),
        KEY idx_tg_notification_queue_status (status, available_at, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}
function ensure_admin_user_deletion_queue($pdo) {
    // A working database may predate migration 006. Keep the API deployable without
    // requiring a full schema dump or a separate manual migration before first use.
    $pdo->exec("CREATE TABLE IF NOT EXISTS admin_user_deletion_queue (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        tg_id BIGINT UNSIGNED NOT NULL,
        requested_by_tg_id BIGINT UNSIGNED NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
        available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        locked_at DATETIME NULL,
        sent_at DATETIME NULL,
        last_error VARCHAR(500) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_admin_user_deletion_status (status, available_at, id),
        KEY idx_admin_user_deletion_tg (tg_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}
function database_table_exists($pdo, $tableName) {
    $stmt = $pdo->prepare('SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=? LIMIT 1');
    $stmt->execute(array((string)$tableName));
    return (bool)$stmt->fetchColumn();
}
function maintenance_state($pdo) {
    $state = array('maintenance_mode'=>false,'maintenance_title'=>'Технические работы','maintenance_message'=>'Сервис временно недоступен. Попробуйте позже.','maintenance_until'=>null);
    $stmt = $pdo->query("SELECT setting_key,setting_value FROM app_settings WHERE setting_key IN ('maintenance_mode','maintenance_title','maintenance_message','maintenance_until')");
    foreach ($stmt->fetchAll() as $row) {
        if ($row['setting_key'] === 'maintenance_mode') $state['maintenance_mode'] = in_array(strtolower((string)$row['setting_value']), array('1','true','yes','on'), true);
        elseif ($row['setting_key'] === 'maintenance_title') $state['maintenance_title'] = (string)$row['setting_value'];
        elseif ($row['setting_key'] === 'maintenance_message') $state['maintenance_message'] = (string)$row['setting_value'];
        elseif ($row['setting_key'] === 'maintenance_until') $state['maintenance_until'] = (string)$row['setting_value'] !== '' ? (string)$row['setting_value'] : null;
    }
    if ($state['maintenance_mode'] && $state['maintenance_until']) {
        $until = strtotime($state['maintenance_until']);
        if ($until !== false && $until <= time()) {
            $pdo->prepare("INSERT INTO app_settings(setting_key,setting_value) VALUES('maintenance_mode','0') ON DUPLICATE KEY UPDATE setting_value='0'")->execute();
            $state['maintenance_mode'] = false;
        }
    }
    return $state;
}
function schedule_telegram_notification_cleanup($chatId, $messageId, $notificationId) {
    try {
        $stmt=db()->prepare('INSERT IGNORE INTO telegram_message_cleanup(chat_id,message_id,notification_id,delete_after) VALUES(?,?,?,DATE_ADD(NOW(),INTERVAL 1 MINUTE))');
        $stmt->execute(array((int)$chatId,(int)$messageId,(int)$notificationId));
    } catch (Exception $e) { error_log('Basalt notification cleanup scheduling failed: ' . $e->getMessage()); }
}
function send_telegram_photo_notification($config, $chatId, $title, $message, $notificationId) {
    if (empty($config['bot_token'])) return false;
    $image = __DIR__ . '/assets/img/logo.jpg';
    if (!is_file($image)) return false;
    $caption = '<b>' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</b>' . "\n\n" . htmlspecialchars(function_exists('mb_substr') ? mb_substr($message, 0, 700, 'UTF-8') : substr($message, 0, 700), ENT_QUOTES, 'UTF-8');
    $keyboard = array('inline_keyboard' => array(array(array('text' => 'Прочитано', 'callback_data' => 'read:' . (int)$notificationId))));
    $post = array('chat_id' => (string)$chatId, 'caption' => $caption, 'parse_mode' => 'HTML', 'reply_markup' => json_encode($keyboard));
    $url = 'https://api.telegram.org/bot' . $config['bot_token'] . '/sendPhoto';
    if (function_exists('curl_init') && class_exists('CURLFile')) {
        $post['photo'] = new CURLFile($image, 'image/jpeg', 'logo.jpg');
        $ch = curl_init($url); curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, $post);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true); curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5); curl_setopt($ch, CURLOPT_TIMEOUT, 12);
        $response = curl_exec($ch); $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
        if ($status < 200 || $status >= 300) error_log('Basalt Telegram notification failed for chat ' . (int)$chatId . ': HTTP ' . $status . ' ' . substr((string)$response, 0, 300));
        $decoded=json_decode((string)$response,true); if ($status>=200 && $status<300 && !empty($decoded['ok']) && !empty($decoded['result']['message_id'])) schedule_telegram_notification_cleanup($chatId,$decoded['result']['message_id'],$notificationId);
        return $status >= 200 && $status < 300;
    }
    $baseUrl = isset($config['site_url']) ? rtrim($config['site_url'], '/') : '';
    if (!$baseUrl) { $host = isset($_SERVER['HTTP_HOST']) ? preg_replace('/[^a-zA-Z0-9.:-]/', '', $_SERVER['HTTP_HOST']) : ''; $baseUrl = $host ? 'https://' . $host : ''; }
    if (!$baseUrl) return false;
    $post['photo'] = $baseUrl . '/assets/img/logo.jpg';
    $context = stream_context_create(array('http' => array('method'=>'POST','header'=>"Content-Type: application/x-www-form-urlencoded\r\n",'content'=>http_build_query($post),'timeout'=>12)));
    $response=@file_get_contents($url, false, $context); $decoded=json_decode((string)$response,true); if ($response!==false && !empty($decoded['ok']) && !empty($decoded['result']['message_id'])) schedule_telegram_notification_cleanup($chatId,$decoded['result']['message_id'],$notificationId); return $response !== false;
}
function body_data() {
    $raw = file_get_contents('php://input');
    $json = json_decode($raw, true);
    if (!is_array($json)) $json = array();
    if (isset($_POST['initData'])) $json['initData'] = $_POST['initData'];
    return $json;
}
function validate_init_data($initData, $botToken) {
    if (!$initData || !$botToken || $botToken === 'CHANGE_ME') return false;
    $params = array();
    parse_str($initData, $params);
    if (empty($params['hash'])) return false;
    $hash = $params['hash'];
    unset($params['hash']);
    ksort($params, SORT_STRING);
    $parts = array();
    foreach ($params as $key => $value) $parts[] = $key . '=' . $value;
    $checkString = implode("\n", $parts);
    $secretKey = hash_hmac('sha256', $botToken, 'WebAppData', true);
    $calculated = hash_hmac('sha256', $checkString, $secretKey);
    if (!hash_equals($calculated, $hash)) return false;
    if (empty($params['auth_date']) || (time() - (int)$params['auth_date']) > 86400 || (int)$params['auth_date'] > time() + 60) return false;
    if (empty($params['user'])) return false;
    $user = json_decode($params['user'], true);
    if (!is_array($user) || empty($user['id'])) return false;
    return $user;
}
function avatar_upload_directory() {
    return __DIR__ . '/uploads/avatars';
}
function avatar_url_is_local($url) {
    return is_string($url) && preg_match('~^/uploads/avatars/[a-f0-9]{64}\.(?:jpg|png|webp)$~i', $url) === 1;
}
function telegram_avatar_host_allowed($host) {
    $host = strtolower((string)$host);
    return $host === 't.me' || $host === 'telegram.org' || $host === 'telegram-cdn.org'
        || substr($host, -13) === '.telegram.org' || substr($host, -17) === '.telegram-cdn.org';
}
function download_avatar_bytes($url, $allowedHosts) {
    if (!function_exists('curl_init')) return null;
    $parts = parse_url((string)$url);
    if (!$parts || strtolower(isset($parts['scheme']) ? $parts['scheme'] : '') !== 'https' || !isset($parts['host'])) return null;
    $host = strtolower($parts['host']);
    $hostAllowed = false;
    foreach ($allowedHosts as $allowedHost) {
        if ($allowedHost !== '' && $allowedHost[0] === '.') {
            if (substr($host, -strlen($allowedHost)) === $allowedHost) { $hostAllowed = true; break; }
        } elseif ($host === strtolower($allowedHost)) { $hostAllowed = true; break; }
    }
    if (!$hostAllowed) return null;
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
    curl_setopt($ch, CURLOPT_TIMEOUT, 7);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
    curl_setopt($ch, CURLOPT_USERAGENT, 'BasaltPerfumeAvatarCache/1.0');
    if (defined('CURLOPT_PROTOCOLS') && defined('CURLPROTO_HTTPS')) curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
    $body = '';
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($handle, $chunk) use (&$body) {
        if (strlen($body) + strlen($chunk) > 4 * 1024 * 1024) return 0;
        $body .= $chunk;
        return strlen($chunk);
    });
    $downloadOk = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($downloadOk === false || $status !== 200 || strlen($body) < 1) return null;
    $info = function_exists('getimagesizefromstring') ? @getimagesizefromstring($body) : false;
    if (!$info || empty($info['mime']) || empty($info[0]) || empty($info[1]) || $info[0] > 4096 || $info[1] > 4096) return null;
    $extensions = array('image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp');
    if (!isset($extensions[$info['mime']])) return null;
    return array('body' => $body, 'extension' => $extensions[$info['mime']]);
}
function save_cached_avatar($tgId, $cacheSeed, $image) {
    if (!is_array($image) || empty($image['body']) || empty($image['extension'])) return null;
    $dir = avatar_upload_directory();
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) return null;
    $hash = hash('sha256', (string)$tgId . "\0" . (string)$cacheSeed);
    $filename = $hash . '.' . $image['extension'];
    $target = $dir . '/' . $filename;
    if (!is_file($target) || filesize($target) < 1) {
        $temp = $target . '.' . bin2hex(random_bytes(4)) . '.tmp';
        if (@file_put_contents($temp, $image['body'], LOCK_EX) === false) { @unlink($temp); return null; }
        @chmod($temp, 0644);
        if (!@rename($temp, $target)) { @unlink($temp); return null; }
    }
    return '/uploads/avatars/' . $filename;
}
function cache_telegram_avatar_from_url($tgId, $url) {
    if (!is_string($url) || $url === '') return null;
    $parts = parse_url($url);
    if (!$parts || !isset($parts['host']) || !telegram_avatar_host_allowed($parts['host'])) return null;
    $seed = hash('sha256', $url);
    $dir = avatar_upload_directory();
    $cacheHash = hash('sha256', (string)$tgId . "\0" . $seed);
    foreach (array('jpg', 'png', 'webp') as $extension) {
        $existing = $dir . '/' . $cacheHash . '.' . $extension;
        if (is_file($existing) && filesize($existing) > 0) return '/uploads/avatars/' . basename($existing);
    }
    // Avoid repeating a slow request on every API call when Telegram's CDN URL
    // redirects to a host that cannot be cached. Retry at most once a day.
    $failureMarker = $dir . '/' . $cacheHash . '.failed';
    if (is_file($failureMarker) && (time() - (int)filemtime($failureMarker)) < 86400) return null;
    $image = download_avatar_bytes($url, array('t.me', 'telegram.org', '.telegram.org', 'telegram-cdn.org', '.telegram-cdn.org'));
    if (!$image) {
        if (!is_dir($dir)) @mkdir($dir, 0755, true);
        if (is_dir($dir)) @file_put_contents($failureMarker, (string)time(), LOCK_EX);
        return null;
    }
    @unlink($failureMarker);
    return save_cached_avatar($tgId, $seed, $image);
}
function telegram_bot_api_json($token, $method, $params) {
    if (!function_exists('curl_init') || !$token || $token === 'CHANGE_ME') return null;
    $url = 'https://api.telegram.org/bot' . $token . '/' . rawurlencode($method) . '?' . http_build_query($params);
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
    curl_setopt($ch, CURLOPT_TIMEOUT, 6);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
    if (defined('CURLOPT_PROTOCOLS') && defined('CURLPROTO_HTTPS')) curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
    $body = curl_exec($ch); $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    if ($body === false || $status !== 200 || strlen($body) > 1024 * 1024) return null;
    $decoded = json_decode($body, true);
    return is_array($decoded) && !empty($decoded['ok']) ? $decoded['result'] : null;
}
function sync_telegram_menu_keyboard($tgId, $blocked, $role, $language, $config) {
    // This is best-effort: WebApp ban state is enforced server-side even if Telegram edit fails.
    try {
        $pdo = db();
        $st = $pdo->prepare('SELECT menu_chat_id,menu_message_id FROM user_settings WHERE tg_id=? LIMIT 1');
        $st->execute(array((int)$tgId)); $row = $st->fetch();
        if (!$row || empty($row['menu_chat_id']) || empty($row['menu_message_id'])) return;
        $url = isset($config['webapp_url']) ? (string)$config['webapp_url'] : (string)($config['site_url'] ?? '');
        if ($url === '' || stripos($url, 'https://') !== 0) return;
        $lang = in_array($language, array('ru','en','kz'), true) ? $language : 'ru';
        $labels = array(
            'ru'=>array('web'=>'Открыть приложение','activate'=>'Активировать / продлить','upload'=>'Загрузить прайс-лист'),
            'en'=>array('web'=>'Open app','activate'=>'Activate / extend','upload'=>'Upload price list'),
            'kz'=>array('web'=>'Қолданбаны ашу','activate'=>'Белсендіру / ұзарту','upload'=>'Прайс-парақ жүктеу'),
        );
        $t = $labels[$lang];
        $buttons = array(array(array('text'=>$t['web'],'web_app'=>array('url'=>$url))));
        if (!$blocked) {
            $buttons[] = array(array('text'=>$t['activate'],'callback_data'=>'activate'));
            if (in_array($role, array('seller','admin'), true)) $buttons[] = array(array('text'=>$t['upload'],'callback_data'=>'how_upload'));
        }
        $markup = json_encode(array('inline_keyboard'=>$buttons), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        telegram_bot_api_json(isset($config['bot_token']) ? $config['bot_token'] : '', 'editMessageReplyMarkup', array(
            'chat_id'=>(int)$row['menu_chat_id'], 'message_id'=>(int)$row['menu_message_id'], 'reply_markup'=>$markup,
        ));
    } catch (Throwable $e) {
        error_log('Basalt Telegram menu keyboard sync skipped for user ' . (int)$tgId . ': ' . $e->getMessage());
    }
}

function cache_telegram_avatar_from_bot_api($tgId, $config) {
    $dir = avatar_upload_directory();
    $failureMarker = $dir . '/' . hash('sha256', (string)$tgId . "\0telegram-bot-api") . '.bot-failed';
    if (is_file($failureMarker) && (time() - (int)filemtime($failureMarker)) < 86400) return null;
    $markFailure = function () use ($dir, $failureMarker) {
        if (!is_dir($dir)) @mkdir($dir, 0755, true);
        if (is_dir($dir)) @file_put_contents($failureMarker, (string)time(), LOCK_EX);
        return null;
    };
    $photos = telegram_bot_api_json(isset($config['bot_token']) ? $config['bot_token'] : '', 'getUserProfilePhotos', array('user_id' => (int)$tgId, 'limit' => 1));
    if (empty($photos['photos'][0]) || !is_array($photos['photos'][0])) return $markFailure();
    $sizes = $photos['photos'][0];
    $largest = end($sizes);
    if (empty($largest['file_id'])) return $markFailure();
    $file = telegram_bot_api_json($config['bot_token'], 'getFile', array('file_id' => $largest['file_id']));
    if (empty($file['file_path'])) return $markFailure();
    $fileUrl = 'https://api.telegram.org/file/bot' . $config['bot_token'] . '/' . ltrim((string)$file['file_path'], '/');
    $image = download_avatar_bytes($fileUrl, array('api.telegram.org'));
    if (!$image) return $markFailure();
    $seed = !empty($largest['file_unique_id']) ? (string)$largest['file_unique_id'] : hash('sha256', (string)$file['file_path']);
    $cachedUrl = save_cached_avatar($tgId, $seed, $image);
    if ($cachedUrl) @unlink($failureMarker); else $markFailure();
    return $cachedUrl;
}
function current_user($data) {
    global $config;
    $user = validate_init_data(isset($data['initData']) ? $data['initData'] : '', $config['bot_token']);
    if (!$user) respond(false, array('error' => 'invalid_telegram_init_data', 'message' => 'Откройте приложение из Telegram.'), 401);
    $pdo = db();
    $lang = isset($user['language_code']) ? strtolower(substr($user['language_code'], 0, 2)) : 'ru';
    if ($lang === 'kk') $lang = 'kz'; // Telegram uses kk for Kazakh.
    if (!in_array($lang, array('ru', 'en', 'kz'), true)) $lang = 'ru';
    $tgId = (int)$user['id'];
    $sourcePhoto = isset($user['photo_url']) ? substr((string)$user['photo_url'], 0, 500) : '';
    $existingStmt = $pdo->prepare('SELECT photo_url FROM users WHERE tg_id=? LIMIT 1');
    $existingStmt->execute(array($tgId));
    $existingPhoto = $existingStmt->fetchColumn();
    // Never call Telegram/CDN from the authentication-critical request. On some
    // shared hosts these requests can take 20+ seconds and make the whole WebApp
    // bootstrap hit the client's 25-second timeout. Prefer an existing local cache;
    // otherwise retain the signed initData photo URL and let the browser load it.
    $photo = avatar_url_is_local($existingPhoto)
        ? $existingPhoto
        : ($sourcePhoto !== '' ? $sourcePhoto : ($existingPhoto ?: null));
    $username = isset($user['username']) ? $user['username'] : null;
    $firstName = isset($user['first_name']) ? $user['first_name'] : null;
    $lastName = isset($user['last_name']) ? $user['last_name'] : null;
    // Use bound values in the duplicate-key clause instead of MySQL 8-only row aliases.
    // This keeps the WebApp API compatible with MariaDB and older MySQL shared hosting.
    $stmt = $pdo->prepare("INSERT INTO users(tg_id,username,first_name,last_name,photo_url) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE username=?,first_name=?,last_name=?,photo_url=CASE WHEN ? LIKE '/uploads/avatars/%' THEN ? WHEN users.photo_url LIKE '/uploads/avatars/%' THEN users.photo_url ELSE COALESCE(?,users.photo_url) END");
    $stmt->execute(array($tgId, $username, $firstName, $lastName, $photo, $username, $firstName, $lastName, $photo, $photo, $photo));
    $stmt = $pdo->prepare('INSERT IGNORE INTO user_settings(tg_id,language) VALUES(?,?)');
    $stmt->execute(array((int)$user['id'], $lang));
    $isAdmin = false;
    $adminIds = array_filter(array_map('trim', explode(',', (string)($config['admin_ids'] ?? ''))));
    if (in_array((string)$user['id'], $adminIds, true)) $isAdmin = true;
    $stmt = $pdo->prepare('SELECT tg_id FROM admins WHERE tg_id=?');
    $stmt->execute(array((int)$user['id']));
    if ($stmt->fetch()) $isAdmin = true;
    if ($isAdmin) {
        $stmt = $pdo->prepare('INSERT IGNORE INTO admins(tg_id) VALUES(?)'); $stmt->execute(array((int)$user['id']));
        $pdo->prepare("UPDATE users SET role='admin' WHERE tg_id=?")->execute(array((int)$user['id']));
    }
    $stmt = $pdo->prepare('SELECT role FROM users WHERE tg_id=? LIMIT 1'); $stmt->execute(array($tgId));
    $role = strtolower(trim((string)$stmt->fetchColumn()));
    // Compatibility fix: some existing installations have the admin role stored in
    // users.role, while the same Telegram ID is missing from admins and admin_ids.
    // Without this check, the role is downgraded to none and the first catalogue
    // request is rejected with a 403 after the overview request succeeds.
    // Do not write to the admins table as a side effect of reading the session.
    // Legacy installations may keep the administrator role only in users.role;
    // treat it as authoritative for this request without requiring a DB mutation.
    $adminRoleFallback = (!$isAdmin && $role === 'admin');
    if ($adminRoleFallback) $isAdmin = true;
    if ($isAdmin && !$adminRoleFallback) {
        // Configured/database administrators retain the existing synchronization path.
        $pdo->prepare('INSERT IGNORE INTO admins(tg_id) VALUES(?)')->execute(array($tgId));
        $pdo->prepare("UPDATE users SET role='admin' WHERE tg_id=?")->execute(array($tgId));
    }
    if (!$isAdmin && !in_array($role, array('seller','buyer','none'), true)) $role='none';
    return array('tg_id' => (int)$user['id'], 'user' => $user, 'is_admin' => $isAdmin, 'role' => $isAdmin ? 'admin' : $role);
}
function subscription_for($tgId) {
    // duration_seconds stays tied to activation→expiry, never to the shrinking remaining time.
    $stmt = db()->prepare('SELECT id,key_prefix,activated_at,available_until,is_frozen,frozen_remaining_sec,duration_days,(available_until>NOW() AND is_frozen=0) AS active,GREATEST(TIMESTAMPDIFF(SECOND,NOW(),available_until),0) AS seconds_left,GREATEST(TIMESTAMPDIFF(SECOND,activated_at,available_until),duration_days*86400,1) AS duration_seconds FROM subscription_keys WHERE used_by_tg_id=? ORDER BY activated_at DESC,id DESC LIMIT 1');
    $stmt->execute(array($tgId));
    $row = $stmt->fetch();
    if (!$row) return null;
    $row['active'] = (bool)$row['active'];
    $row['seconds_left'] = (int)$row['seconds_left'];
    $row['duration_seconds'] = (int)$row['duration_seconds'];
    return $row;
}
function require_active_subscription($tgId) {
    global $config;
    // Administrators can use the control room and catalogue without a paid user subscription.
    $adminIds = array_filter(array_map('trim', explode(',', (string)($config['admin_ids'] ?? ''))));
    if (in_array((string)$tgId, $adminIds, true)) return;
    $adminCheck = db()->prepare("SELECT (role='admin' OR EXISTS(SELECT 1 FROM admins a WHERE a.tg_id=users.tg_id)) AS allowed FROM users WHERE tg_id=? LIMIT 1");
    $adminCheck->execute(array((int)$tgId));
    if ((int)$adminCheck->fetchColumn() === 1) return;
    $sub = subscription_for($tgId);
    if (!$sub || empty($sub['active'])) respond(false, array('error'=>'subscription_required','message'=>'Для этого раздела нужна активная подписка. Отправьте /start боту и активируйте ключ.'), 403);
}
function subscription_key_crypto_keys($config, $forceFallback = false) {
    $secret = isset($config['key_encryption_secret']) ? trim((string)$config['key_encryption_secret']) : '';
    if ($forceFallback || $secret === '') {
        // Stable fallback for installations that have not configured a dedicated secret yet.
        $secret = (string)(isset($config['bot_token']) ? $config['bot_token'] : '') . "\0" . (string)(isset($config['db_pass']) ? $config['db_pass'] : '') . "\0basalt-subscription-key-v1";
    }
    $master = hash('sha256', $secret, true);
    return array(hash_hmac('sha256', 'encryption', $master, true), hash_hmac('sha256', 'authentication', $master, true));
}
function random_subscription_key_group() {
    // 32-symbol alphabet avoids visually ambiguous characters and provides 80 bits per 16-character key body.
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $out = '';
    $max = strlen($alphabet) - 1;
    for ($i = 0; $i < 4; $i++) $out .= $alphabet[random_int(0, $max)];
    return $out;
}
function encrypt_subscription_key($plain, $config) {
    if (!function_exists('openssl_encrypt')) throw new RuntimeException('Key encryption is unavailable on this server.');
    $keys = subscription_key_crypto_keys($config);
    $iv = random_bytes(16);
    $cipher = openssl_encrypt((string)$plain, 'aes-256-cbc', $keys[0], OPENSSL_RAW_DATA, $iv);
    if ($cipher === false) throw new RuntimeException('Unable to encrypt an activation key.');
    $mac = hash_hmac('sha256', $iv . $cipher, $keys[1], true);
    return base64_encode($iv . $mac . $cipher);
}
function decrypt_subscription_key($encoded, $config, $forceFallback = false) {
    if (!function_exists('openssl_decrypt') || !is_string($encoded) || $encoded === '') return null;
    $packet = base64_decode($encoded, true);
    if ($packet === false || strlen($packet) < 49) return null;
    $iv = substr($packet, 0, 16); $mac = substr($packet, 16, 32); $cipher = substr($packet, 48);
    $keys = subscription_key_crypto_keys($config, $forceFallback);
    $expected = hash_hmac('sha256', $iv . $cipher, $keys[1], true);
    if (!hash_equals($expected, $mac)) return null;
    $plain = openssl_decrypt($cipher, 'aes-256-cbc', $keys[0], OPENSSL_RAW_DATA, $iv);
    return $plain === false ? null : $plain;
}
function admin_required($auth) { if (!$auth['is_admin']) respond(false, array('error' => 'admin_required'), 403); }
function require_seller_or_admin($auth) {
    if (!in_array(isset($auth['role']) ? $auth['role'] : 'seller', array('seller','admin'), true)) {
        respond(false, array('error'=>'role_forbidden','message'=>'Покупателям доступен только поиск товаров.'), 403);
    }
}
function enforce_account_locks($auth, $tgId, $action, $pdo) {
    if (!empty($auth['is_admin'])) return;
    if (!in_array($action, array('overview','me'), true)) {
        $stmt=$pdo->prepare('SELECT is_blocked,banned_until FROM users WHERE tg_id=? LIMIT 1');
        $stmt->execute(array((int)$tgId)); $state=$stmt->fetch();
        if ($state && !empty($state['is_blocked'])) {
            $until=$state['banned_until'] ? strtotime($state['banned_until']) : false;
            if (!$state['banned_until'] || ($until !== false && $until > time())) {
                respond(false,array('error'=>'user_banned','message'=>'Доступ к приложению заблокирован. Откройте главную страницу для подробностей.','banned_until'=>$state['banned_until']),403);
            }
            $pdo->prepare('UPDATE users SET is_blocked=0,banned_until=NULL,ban_reason=NULL,ban_details=NULL WHERE tg_id=?')->execute(array((int)$tgId));
        }
    }
    $system = maintenance_state($pdo);
    // overview/me must remain readable so the WebApp can display the maintenance screen.
    if (!empty($system['maintenance_mode']) && !in_array($action, array('overview','me'), true)) {
        respond(false,array('error'=>'maintenance_mode','title'=>$system['maintenance_title'],'message'=>$system['maintenance_message'],'until'=>$system['maintenance_until']),503);
    }
}

try {
    $input = body_data();
    $auth = current_user($input);
    $tgId = $auth['tg_id'];
    $action = isset($input['action']) ? (string)$input['action'] : (isset($_GET['action']) ? (string)$_GET['action'] : 'overview');
    $pdo = db();
    // Enforce system maintenance and bans before subscription gating, so even users with
    // no role/expired access receive the maintenance screen instead of ordinary app APIs.
    enforce_account_locks($auth, $tgId, $action, $pdo);
    // Users without a role or active subscription may only read the minimum account
    // overview needed to render the subscription gate. Do not expose catalogue/settings APIs.
    if (empty($auth['is_admin']) && !in_array($action, array('overview','me'), true)) {
        $gateSubscription = subscription_for($tgId);
        if ($auth['role'] === 'none' || !$gateSubscription || empty($gateSubscription['active'])) {
            respond(false, array('error'=>'subscription_required','message'=>'Для доступа к приложению купите или продлите подписку в Telegram-боте.'), 403);
        }
    }
    require __DIR__ . '/actions/cache_avatar.php';
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
                'is_admin'=>false,
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
            $favCountStmt = $pdo->prepare('SELECT COUNT(*) n FROM user_favorites WHERE user_tg_id=?'); $favCountStmt->execute(array($tgId)); $favoritesCount = (int)$favCountStmt->fetch()['n'];
        }
        $system = maintenance_state($pdo);
        $profile['is_blocked']=(bool)$profile['is_blocked'];
        $profile['ban_active']=$profile['is_blocked'] && (!$profile['banned_until'] || strtotime($profile['banned_until']) > time());
        if ($profile['is_blocked'] && !$profile['ban_active']) { $pdo->prepare('UPDATE users SET is_blocked=0,banned_until=NULL,ban_reason=NULL,ban_details=NULL WHERE tg_id=?')->execute(array($tgId)); $profile['is_blocked']=false; }
        $profile['role']=$auth['role']; $profile['full_name']=trim((string)$profile['first_name'].' '.(string)$profile['last_name']);
        respond(true, array('profile'=>$profile,'role'=>$auth['role'],'subscription'=>$sub,'has_ever_activated_subscription'=>!empty($sub),'favorites_count'=>$favoritesCount,'files_count'=>$files,'products_count'=>$products,'unread_count'=>$unread,'is_admin'=>$auth['is_admin'],'developer_username'=>$config['developer_username'],'bot_username'=>$config['bot_username'],'system'=>$system), 200);
    }
    if ($action === 'files') {
        require_seller_or_admin($auth); require_active_subscription($tgId);
        $stmt=$pdo->prepare('SELECT pl.id,pl.filename,pl.size_bytes,pl.status,pl.imported_at,COUNT(DISTINCT sr.id) AS row_count,COUNT(DISTINCT p.id) AS product_count,SUM(p.needs_review) AS review_count FROM price_lists pl LEFT JOIN source_rows sr ON sr.price_list_id=pl.id LEFT JOIN products p ON p.source_row_id=sr.id WHERE pl.owner_tg_id=? GROUP BY pl.id ORDER BY pl.imported_at DESC');
        $stmt->execute(array($tgId)); respond(true,$stmt->fetchAll(),200);
    }
    if ($action === 'delete_file') {
        require_seller_or_admin($auth); require_active_subscription($tgId);
        $fileId = isset($input['file_id']) ? (int)$input['file_id'] : 0;
        $targetOwner = (!empty($auth['is_admin']) && isset($input['user_id'])) ? (int)$input['user_id'] : (int)$tgId;
        if ($targetOwner < 1) respond(false,array('error'=>'invalid_user_id'),400);
        $stmt=$pdo->prepare('SELECT filepath FROM price_lists WHERE id=? AND owner_tg_id=?'); $stmt->execute(array($fileId,$targetOwner)); $f=$stmt->fetch();
        if (!$f) respond(false,array('error'=>'file_not_found'),404);
        if (!empty($f['filepath']) && is_file($f['filepath'])) @unlink($f['filepath']);
        $stmt=$pdo->prepare('DELETE FROM price_lists WHERE id=? AND owner_tg_id=?'); $stmt->execute(array($fileId,$targetOwner));
        $stmt=$pdo->prepare('INSERT INTO app_notifications(tg_id,kind,title,body) VALUES(?,\'system\',\'Прайс-лист удалён\',\'Запись прайс-листа удалена из каталога.\')'); $stmt->execute(array($targetOwner));
        send_telegram_photo_notification($config, $targetOwner, 'Прайс-лист удалён', 'Запись прайс-листа удалена из каталога.', (int)$pdo->lastInsertId());
        respond(true,array('deleted'=>true),200);
    }
    if ($action === 'brands') {
        require_active_subscription($tgId);
        if (!empty($auth['is_admin'])) {
            $stmt=$pdo->query("SELECT DISTINCT p.brand FROM products p WHERE p.brand IS NOT NULL AND p.brand<>'' ORDER BY p.brand");
        } elseif ($auth['role'] === 'buyer') {
            $stmt=$pdo->query("SELECT DISTINCT p.brand FROM products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id LEFT JOIN user_settings seller_privacy ON seller_privacy.tg_id=pl.owner_tg_id WHERE COALESCE(seller_privacy.seller_products_public,0)=1 AND p.brand IS NOT NULL AND p.brand<>'' ORDER BY p.brand");
        } else {
            $stmt=$pdo->prepare("SELECT DISTINCT p.brand FROM products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id WHERE pl.owner_tg_id=? AND p.brand IS NOT NULL AND p.brand<>'' ORDER BY p.brand"); $stmt->execute(array($tgId));
        }
        respond(true,$stmt->fetchAll(PDO::FETCH_COLUMN),200);
    }
    if ($action === 'filter_options') {
        require_active_subscription($tgId);
        $isAdmin = !empty($auth['is_admin']);
        $isBuyer = $auth['role'] === 'buyer' && !$isAdmin;
        $isSellerWithoutLists = $auth['role'] === 'seller' && !$isAdmin;
        if ($isSellerWithoutLists) {
            $ownListCount = $pdo->prepare('SELECT COUNT(*) FROM price_lists WHERE owner_tg_id=?');
            $ownListCount->execute(array($tgId));
            $isSellerWithoutLists = (int)$ownListCount->fetchColumn() === 0;
        }
        // Sellers who have not uploaded a single list can still browse other sellers'
        // explicitly public products. Sellers with their own lists stay privately scoped.
        $isPublicCatalogFallback = $isSellerWithoutLists;
        $globalCatalog = $isBuyer || $isAdmin || $isPublicCatalogFallback;
        if ($isAdmin) {
            $scope = '';
            $scopeArgs = array();
            $join = ' FROM products p';
        } elseif ($isBuyer || $isPublicCatalogFallback) {
            $scope = ' WHERE COALESCE(seller_privacy.seller_products_public,0)=1';
            $scopeArgs = array();
            $join = ' FROM products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id LEFT JOIN user_settings seller_privacy ON seller_privacy.tg_id=pl.owner_tg_id';
        } else {
            $scope = ' WHERE pl.owner_tg_id=?';
            $scopeArgs = array($tgId);
            $join = ' FROM products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id';
        }
        $stmt=$pdo->prepare('SELECT DISTINCT p.brand'.$join.$scope.($scope ? ' AND' : ' WHERE')." p.brand IS NOT NULL AND p.brand<>'' ORDER BY p.brand"); $stmt->execute($scopeArgs); $brands=$stmt->fetchAll(PDO::FETCH_COLUMN);
        $stmt=$pdo->prepare('SELECT DISTINCT p.volume_ml'.$join.$scope.($scope ? ' AND' : ' WHERE')." p.volume_ml IS NOT NULL AND UPPER(COALESCE(p.type,'')) NOT IN ('SHOWCARD','BILLBOARD') ORDER BY p.volume_ml"); $stmt->execute($scopeArgs); $volumes=$stmt->fetchAll(PDO::FETCH_COLUMN);
        $stmt=$pdo->prepare('SELECT DISTINCT p.size_width,p.size_height,p.size_unit'.$join.$scope.($scope ? ' AND' : ' WHERE')." p.size_width IS NOT NULL AND p.size_height IS NOT NULL AND p.size_unit IS NOT NULL AND UPPER(COALESCE(p.type,'')) IN ('SHOWCARD','BILLBOARD') ORDER BY p.size_width,p.size_height,p.size_unit"); $stmt->execute($scopeArgs); $sizeRows=$stmt->fetchAll(); $sizes=array();
        foreach($sizeRows as $sizeRow){$sw=rtrim(rtrim(number_format((float)$sizeRow['size_width'],3,'.',''),'0'),'.');$sh=rtrim(rtrim(number_format((float)$sizeRow['size_height'],3,'.',''),'0'),'.');$unit=(string)$sizeRow['size_unit'];$sizes[]=array('value'=>'size:'.$sw.':'.$sh.':'.$unit,'label'=>$sw.' × '.$sh.' '.$unit);}
        $stmt=$pdo->prepare('SELECT DISTINCT p.type'.$join.$scope.($scope ? ' AND' : ' WHERE')." p.type IS NOT NULL AND p.type<>'' ORDER BY p.type"); $stmt->execute($scopeArgs); $types=$stmt->fetchAll(PDO::FETCH_COLUMN);
        if ($globalCatalog) $files=array(); else { $stmt=$pdo->prepare('SELECT id,filename,status,imported_at FROM price_lists WHERE owner_tg_id=? ORDER BY imported_at DESC,id DESC'); $stmt->execute(array($tgId)); $files=$stmt->fetchAll(); }
        $stmt=$pdo->prepare('SELECT DISTINCT p.gender'.$join.$scope.($scope ? ' AND' : ' WHERE').' p.gender IS NOT NULL ORDER BY p.gender'); $stmt->execute($scopeArgs); $genders=$stmt->fetchAll(PDO::FETCH_COLUMN);
        $stmt=$pdo->prepare('SELECT DISTINCT p.category'.$join.$scope.($scope ? ' AND' : ' WHERE').' p.category IS NOT NULL ORDER BY p.category'); $stmt->execute($scopeArgs); $categories=$stmt->fetchAll(PDO::FETCH_COLUMN);
        $sellers=array();
        if ($isBuyer || $isAdmin || $isPublicCatalogFallback) {
            $sellerStmt=$pdo->query("SELECT DISTINCT u.tg_id,u.username,TRIM(CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,''))) AS full_name,COALESCE(seller_privacy.seller_products_public,0) AS seller_products_public,COALESCE(seller_privacy.seller_dm_enabled,0) AS seller_dm_enabled,(SELECT COUNT(*) FROM products pcount JOIN source_rows srcount ON srcount.id=pcount.source_row_id JOIN price_lists plcount ON plcount.id=srcount.price_list_id WHERE plcount.owner_tg_id=u.tg_id) AS product_count,CASE WHEN COALESCE(seller_privacy.seller_products_public,0)=1 THEN 0 ELSE 1 END AS privacy_order FROM price_lists pl JOIN users u ON u.tg_id=pl.owner_tg_id LEFT JOIN user_settings seller_privacy ON seller_privacy.tg_id=pl.owner_tg_id ORDER BY privacy_order ASC,full_name,u.username");
            $sellers=$sellerStmt->fetchAll();
            foreach($sellers as &$sellerRow){
                $isPrivate = (int)$sellerRow['seller_products_public'] !== 1;
                $sellerRow['is_private'] = (!$isAdmin && $isPrivate) ? 1 : 0;
                // Keep a separate public flag for the search UI's public product count;
                // do not expose the raw privacy/settings columns themselves.
                $sellerRow['is_public'] = (int)$sellerRow['seller_products_public'] === 1 ? 1 : 0;
                $sellerRow['seller_dm_available'] = ($isAdmin || (!$isPrivate && (int)$sellerRow['seller_dm_enabled'] === 1)) ? 1 : 0;
                if ($isAdmin) {
                    $sellerRow['tg_id']=(int)$sellerRow['tg_id'];
                    if(trim((string)$sellerRow['full_name'])==='')$sellerRow['full_name']=$sellerRow['username']?'@'.$sellerRow['username']:'ID '.$sellerRow['tg_id'];
                } elseif ($isPrivate) {
                    // Never expose a private seller's Telegram ID, real name or username.
                    $sellerRow['tg_id']=0;
                    $sellerRow['username']=null;
                    $sellerRow['full_name']='Продавец-'.str_pad((string)random_int(0,999999),6,'0',STR_PAD_LEFT);
                    $sellerRow['seller_dm_available']=0;
                } else {
                    $sellerRow['tg_id']=(int)$sellerRow['tg_id'];
                    $sellerRow['username']=null; // buyer must not see @username
                    if(trim((string)$sellerRow['full_name'])==='')$sellerRow['full_name']='Продавец';
                }
                unset($sellerRow['seller_products_public'],$sellerRow['seller_dm_enabled'],$sellerRow['privacy_order']);
            } unset($sellerRow);
        }
        $priceExpr = $globalCatalog ? 'p.price_usd*p.price_multiplier' : 'p.price_usd';
        $stmt=$pdo->prepare('SELECT MIN('.$priceExpr.') AS min_price,MAX('.$priceExpr.') AS max_price'.$join.$scope.($scope ? ' AND' : ' WHERE').' p.price_usd IS NOT NULL'); $stmt->execute($scopeArgs); $priceBounds=$stmt->fetch();
        respond(true,array('brands'=>$brands,'volumes'=>$volumes,'sizes'=>$sizes,'types'=>$types,'files'=>$files,'genders'=>$genders,'categories'=>$categories,'sellers'=>$sellers,'public_catalog_fallback'=>$isPublicCatalogFallback,'min_price'=>$priceBounds ? $priceBounds['min_price'] : null,'max_price'=>$priceBounds ? $priceBounds['max_price'] : null),200);
    }
    if ($action === 'products' || $action === 'best_prices') {
        require_active_subscription($tgId);
        $q = isset($input['q']) ? trim((string)$input['q']) : '';
        $brand = isset($input['brand']) ? trim((string)$input['brand']) : '';
        $type = isset($input['type']) ? trim((string)$input['type']) : '';
        $volume = null; $sizeFilter = null;
        $measureFilter = isset($input['volume']) ? trim((string)$input['volume']) : '';
        if ($measureFilter !== '' && preg_match('/^size:([0-9]+(?:\.[0-9]+)?):([0-9]+(?:\.[0-9]+)?):(mm|cm)$/', $measureFilter, $measureMatch)) {
            $sizeFilter = array('width'=>(float)$measureMatch[1], 'height'=>(float)$measureMatch[2], 'unit'=>$measureMatch[3]);
        } elseif ($measureFilter !== '' && is_numeric($measureFilter)) {
            $volume = (float)$measureFilter;
        }
        $tester = isset($input['tester']) && $input['tester'] !== '' ? (int)$input['tester'] : null;
        $setOnly = isset($input['is_set']) && $input['is_set'] !== '' ? (int)$input['is_set'] : null;
        $fileId = isset($input['file_id']) && $input['file_id'] !== '' ? (int)$input['file_id'] : null;
        if ($auth['role'] === 'buyer' || !empty($auth['is_admin'])) $fileId = null;
        $sellerIds=array();
        $isSellerWithoutLists = $auth['role'] === 'seller' && empty($auth['is_admin']);
        if ($isSellerWithoutLists) {
            $ownListCount = $pdo->prepare('SELECT COUNT(*) FROM price_lists WHERE owner_tg_id=?');
            $ownListCount->execute(array($tgId));
            $isSellerWithoutLists = (int)$ownListCount->fetchColumn() === 0;
        }
        $isPublicCatalogFallback = $isSellerWithoutLists;
        if (($auth['role']==='buyer' || !empty($auth['is_admin']) || $isPublicCatalogFallback) && isset($input['seller_ids']) && is_array($input['seller_ids'])) {
            foreach($input['seller_ids'] as $sellerId){$sellerId=(int)$sellerId;if($sellerId>0&&!in_array($sellerId,$sellerIds,true))$sellerIds[]=$sellerId;if(count($sellerIds)>=100)break;}
        }
        $gender = isset($input['gender']) ? trim((string)$input['gender']) : '';
        $category = isset($input['category']) ? trim((string)$input['category']) : '';
        $review = isset($input['needs_review']) && $input['needs_review'] !== '' ? (int)$input['needs_review'] : null;
        $minPrice = isset($input['min_price']) && $input['min_price'] !== '' ? (float)$input['min_price'] : null;
        $maxPrice = isset($input['max_price']) && $input['max_price'] !== '' ? (float)$input['max_price'] : null;
        $sort = isset($input['sort']) ? (string)$input['sort'] : 'price_asc';
        $priceExpr = ($auth['role'] === 'buyer' || !empty($auth['is_admin']) || $isPublicCatalogFallback) ? '(p.price_usd * p.price_multiplier)' : 'p.price_usd';
        $sortSql = $priceExpr.' ASC';
        if ($sort === 'price_desc') $sortSql=$priceExpr.' DESC'; elseif ($sort === 'name') $sortSql='p.name ASC'; elseif ($sort === 'name_desc') $sortSql='p.name DESC'; elseif ($sort === 'volume') $sortSql="(CASE WHEN UPPER(COALESCE(p.type,'')) IN ('DISPLAY','SHOWCARD','BILLBOARD') THEN (CASE WHEN p.size_unit='mm' THEN COALESCE(p.size_width,0)*COALESCE(p.size_height,0)/100 ELSE COALESCE(p.size_width,0)*COALESCE(p.size_height,0) END) ELSE COALESCE(p.volume_ml,0) END) ASC"; elseif ($sort === 'newest') $sortSql='pl.imported_at DESC,pl.id DESC'; elseif ($sort === 'oldest') $sortSql='pl.imported_at ASC,pl.id ASC';
        $globalCatalog = $auth['role'] === 'buyer' || !empty($auth['is_admin']) || $isPublicCatalogFallback;
        $isPublicCatalogViewer = ($auth['role'] === 'buyer' && empty($auth['is_admin'])) || $isPublicCatalogFallback;
        $where = $globalCatalog ? '1=1' : 'pl.owner_tg_id=?'; $args=$globalCatalog ? array() : array($tgId);
        if ($isPublicCatalogViewer) $where .= ' AND EXISTS (SELECT 1 FROM user_settings seller_privacy WHERE seller_privacy.tg_id=pl.owner_tg_id AND COALESCE(seller_privacy.seller_products_public,0)=1)';
        if ($q !== '') { $where .= ' AND (p.name LIKE ? OR p.brand LIKE ? OR p.article LIKE ? OR p.raw_title LIKE ?)'; $like='%'.$q.'%'; $args[]=$like; $args[]=$like; $args[]=$like; $args[]=$like; }
        if ($brand !== '') { $where .= ' AND p.brand=?'; $args[]=$brand; }
        if ($type !== '') { $where .= ' AND p.type=?'; $args[]=$type; }
        if ($sizeFilter !== null) { $where .= ' AND p.size_width=? AND p.size_height=? AND p.size_unit=?'; $args[]=$sizeFilter['width']; $args[]=$sizeFilter['height']; $args[]=$sizeFilter['unit']; } elseif ($volume !== null) { $where .= ' AND p.volume_ml=?'; $args[]=$volume; }
        if ($tester !== null) { $where .= ' AND p.is_tester=?'; $args[]=$tester ? 1 : 0; }
        if ($setOnly !== null) { $where .= ' AND p.is_set=?'; $args[]=$setOnly ? 1 : 0; }
        if ($fileId !== null) { $where .= ' AND pl.id=?'; $args[]=$fileId; }
        if ($sellerIds) { $where .= ' AND pl.owner_tg_id IN ('.implode(',',array_fill(0,count($sellerIds),'?')).')'; foreach($sellerIds as $sellerId)$args[]=$sellerId; }
        if ($gender !== '') { $where .= ' AND p.gender=?'; $args[]=$gender; }
        if ($category !== '') { $where .= ' AND p.category=?'; $args[]=$category; }
        if ($review !== null && $auth['role'] !== 'buyer') { $where .= ' AND p.needs_review=?'; $args[]=$review ? 1 : 0; }
        if ($minPrice !== null) { $where .= ' AND '.$priceExpr.'>=?'; $args[]=$minPrice; }
        if ($maxPrice !== null) { $where .= ' AND '.$priceExpr.'<=?'; $args[]=$maxPrice; }

        $baseSelect = $auth['role'] === 'buyer'
            ? 'SELECT p.id,p.brand,p.name,p.type,p.category,p.volume_ml,p.volume_text,p.display_kind,p.size_width,p.size_height,p.size_unit,(p.price_usd*p.price_multiplier) AS price_usd,p.currency,p.gender,p.is_tester,p.is_set,0 AS needs_review,NULL AS defects_json,NULL AS file_id,NULL AS filename'
            : 'SELECT p.id,p.brand,p.name,p.type,p.category,p.volume_ml,p.volume_text,p.display_kind,p.size_width,p.size_height,p.size_unit,p.price_usd,p.price_usd AS base_price,p.price_multiplier,(p.price_usd*p.price_multiplier) AS effective_price,p.price_raw,p.currency,p.gender,p.is_tester,p.is_set,p.needs_review,p.defects_json,pl.id AS file_id,pl.filename';
        if ($action === 'best_prices') {
            $compareExpr = ($auth['role'] === 'buyer' || !empty($auth['is_admin']) || $isPublicCatalogFallback) ? '(p2.price_usd*p2.price_multiplier)' : 'p2.price_usd';
            $ownScope = $globalCatalog ? '1=1' : 'pl2.owner_tg_id=pl.owner_tg_id';
            if ($isPublicCatalogViewer) $ownScope .= ' AND EXISTS (SELECT 1 FROM user_settings seller_privacy2 WHERE seller_privacy2.tg_id=pl2.owner_tg_id AND COALESCE(seller_privacy2.seller_products_public,0)=1)';
            $sql=$baseSelect.' FROM products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id WHERE '.$where.' AND p.price_usd IS NOT NULL AND '.$priceExpr.'=(SELECT MIN('.$compareExpr.') FROM products p2 JOIN source_rows sr2 ON sr2.id=p2.source_row_id JOIN price_lists pl2 ON pl2.id=sr2.price_list_id WHERE '.$ownScope.' AND COALESCE(p2.brand,\'\')=COALESCE(p.brand,\'\') AND p2.name=p.name AND COALESCE(p2.type,\'\')=COALESCE(p.type,\'\') AND COALESCE(p2.volume_ml,0)=COALESCE(p.volume_ml,0) AND (CASE WHEN p2.size_unit=\'mm\' THEN COALESCE(p2.size_width,0)/10 ELSE COALESCE(p2.size_width,0) END)=(CASE WHEN p.size_unit=\'mm\' THEN COALESCE(p.size_width,0)/10 ELSE COALESCE(p.size_width,0) END) AND (CASE WHEN p2.size_unit=\'mm\' THEN COALESCE(p2.size_height,0)/10 ELSE COALESCE(p2.size_height,0) END)=(CASE WHEN p.size_unit=\'mm\' THEN COALESCE(p.size_height,0)/10 ELSE COALESCE(p.size_height,0) END) AND p2.is_tester=p.is_tester AND p2.is_set=p.is_set AND COALESCE(p2.gender,\'\')=COALESCE(p.gender,\'\')) ORDER BY '.$sortSql.',p.name LIMIT 100';
        } else {
            $sql=$baseSelect.' FROM products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id WHERE '.$where.' ORDER BY '.$sortSql.',p.name LIMIT 100';
        }
        $stmt=$pdo->prepare($sql); $stmt->execute($args); $productRows=$stmt->fetchAll();
        foreach ($productRows as &$catalogProductRow) $catalogProductRow['public_catalog_fallback']=$isPublicCatalogFallback ? 1 : 0; unset($catalogProductRow);
        if (in_array($auth['role'], array('buyer','seller'), true) || !empty($auth['is_admin'])) {
            ensure_user_favorites_table($pdo);
            $favStmt=$pdo->prepare('SELECT product_id FROM user_favorites WHERE user_tg_id=?'); $favStmt->execute(array($tgId));
            $favoriteIds=array(); foreach ($favStmt->fetchAll(PDO::FETCH_COLUMN) as $favId) $favoriteIds[(string)$favId]=true;
            foreach ($productRows as &$productRow) $productRow['is_favorite']=isset($favoriteIds[(string)$productRow['id']]) ? 1 : 0;
            unset($productRow);
        }
        respond(true,$productRows,200);
    }
    if ($action === 'product_details') {
        require_active_subscription($tgId);
        $productId=isset($input['product_id'])?(int)$input['product_id']:0;if($productId<1)respond(false,array('error'=>'invalid_product_id'),400);
        $isSellerWithoutLists = $auth['role'] === 'seller' && empty($auth['is_admin']);
        if ($isSellerWithoutLists) {
            $ownListCount = $pdo->prepare('SELECT COUNT(*) FROM price_lists WHERE owner_tg_id=?');
            $ownListCount->execute(array($tgId));
            $isSellerWithoutLists = (int)$ownListCount->fetchColumn() === 0;
        }
        $isPublicCatalogFallback = $isSellerWithoutLists;
        $globalCatalog=$auth['role']==='buyer'||!empty($auth['is_admin'])||$isPublicCatalogFallback;
        $sql="SELECT p.id,p.brand,p.name,p.type,p.category,p.volume_ml,p.volume_text,p.display_kind,p.size_width,p.size_height,p.size_unit,p.gender,p.article,p.raw_title,p.is_tester,p.is_set,p.price_usd AS base_price,p.price_multiplier,(p.price_usd*p.price_multiplier) AS effective_price,p.currency,p.needs_review,pl.id AS file_id,pl.filename,pl.status AS file_status,pl.owner_tg_id AS seller_tg_id,u.username AS seller_username,u.first_name AS seller_first_name,u.last_name AS seller_last_name,COALESCE(seller_privacy.seller_products_public,0) AS seller_products_public,COALESCE(seller_privacy.seller_dm_enabled,0) AS seller_dm_enabled FROM products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id LEFT JOIN users u ON u.tg_id=pl.owner_tg_id LEFT JOIN user_settings seller_privacy ON seller_privacy.tg_id=pl.owner_tg_id WHERE p.id=?";
        $args=array($productId);if(!$globalCatalog){$sql.=' AND pl.owner_tg_id=?';$args[]=$tgId;}elseif(($auth['role']==='buyer'&&empty($auth['is_admin']))||$isPublicCatalogFallback){$sql.=' AND COALESCE(seller_privacy.seller_products_public,0)=1';}$sql.=' LIMIT 1';$st=$pdo->prepare($sql);$st->execute($args);$product=$st->fetch();if(!$product)respond(false,array('error'=>'product_not_found','message'=>'Товар не найден или недоступен.'),404);
        $product['public_catalog_fallback']=$isPublicCatalogFallback ? 1 : 0;$product['can_favorite']=(in_array($auth['role'],array('buyer','seller'),true)||!empty($auth['is_admin']));$product['is_favorite']=0;
        if($product['can_favorite']){ensure_user_favorites_table($pdo);$f=$pdo->prepare('SELECT 1 FROM user_favorites WHERE user_tg_id=? AND product_id=?');$f->execute(array($tgId,$productId));$product['is_favorite']=$f->fetchColumn()?1:0;}
        $product['seller_tg_id']=(int)$product['seller_tg_id'];$product['seller_name']=trim((string)$product['seller_first_name'].' '.(string)$product['seller_last_name']);
        $product['seller_dm_available']=(!empty($auth['is_admin']) || ((int)$product['seller_products_public']===1 && (int)$product['seller_dm_enabled']===1))?1:0;
        if (empty($auth['is_admin']) && (int)$product['seller_dm_available']!==1) $product['seller_username']=null;
        unset($product['seller_first_name'],$product['seller_last_name'],$product['seller_products_public'],$product['seller_dm_enabled']);
        respond(true,$product,200);
    }
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
    if ($action === 'notifications') {
        if ($auth['role'] === 'buyer') {
            $stmt=$pdo->prepare("SELECT id,kind,title,body,is_read,created_at FROM app_notifications WHERE tg_id=? AND kind NOT IN ('file_processed','processed_file','file_processing','price_list_processed') AND title NOT LIKE '%Обработан%' AND title NOT LIKE '%обработк%' AND title NOT LIKE '%Processed%' AND title NOT LIKE '%processing%' AND body NOT LIKE '%обработ%' AND body NOT LIKE '%processing%' AND body NOT LIKE '%processed%' ORDER BY created_at DESC LIMIT 100");
        } else {
            $stmt=$pdo->prepare('SELECT id,kind,title,body,is_read,created_at FROM app_notifications WHERE tg_id=? ORDER BY created_at DESC LIMIT 100');
        }
        $stmt->execute(array($tgId)); $rows=$stmt->fetchAll();
        foreach ($rows as &$notice) {
            $title=(string)$notice['title'];
            $body=(string)$notice['body'];
            $failed = (strpos($title,'Не удалось обработать')!==false || stripos($title,'processing failed')!==false || strpos($title,'Прайс-парақты өңдеу сәтсіз')!==false);
            $containsInternalDetails = (bool)preg_match('/(?:traceback|exception|sqlstate|\bSELECT\b|\bINSERT\b|\bUPDATE\b|unknown column|integrityerror|operationalerror|parseerror|stack trace|\.py:\d+)/iu',$body);
            if ($failed || $containsInternalDetails) {
                $filename='';
                if (preg_match('/(?:Файл|File):\s*([^\r\n]+)/u',$body,$m)) $filename=trim($m[1]);
                $notice['body']=($filename!==''?'Файл: '.$filename."\n":'').'Не удалось обработать файл. Проверьте формат и попробуйте загрузить его повторно. Технические сведения сохранены в журнале.';
            }
        }
        unset($notice); respond(true,$rows,200);
    }
    if ($action === 'mark_read') {
        $id=isset($input['id'])?(int)$input['id']:0; $stmt=$pdo->prepare('UPDATE app_notifications SET is_read=1 WHERE id=? AND tg_id=?'); $stmt->execute(array($id,$tgId)); respond(true,array('updated'=>$stmt->rowCount()),200);
    }
    if ($action === 'mark_all_read') {
        if ($auth['role']==='buyer') {
            $stmt=$pdo->prepare("UPDATE app_notifications SET is_read=1 WHERE tg_id=? AND is_read=0 AND kind NOT IN ('file_processed','processed_file','file_processing','price_list_processed') AND title NOT LIKE '%Обработан%' AND title NOT LIKE '%обработк%' AND title NOT LIKE '%Processed%' AND title NOT LIKE '%processing%' AND body NOT LIKE '%обработ%' AND body NOT LIKE '%processing%' AND body NOT LIKE '%processed%'");
        } else {
            $stmt=$pdo->prepare('UPDATE app_notifications SET is_read=1 WHERE tg_id=? AND is_read=0');
        }
        $stmt->execute(array($tgId)); respond(true,array('updated'=>$stmt->rowCount()),200);
    }
    if ($action === 'settings') {
        $stmt=$pdo->prepare('SELECT language,theme,appearance,notify_updates,notify_processed_files,notify_subscription,seller_products_public,seller_dm_enabled FROM user_settings WHERE tg_id=?'); $stmt->execute(array($tgId)); $userSettings=$stmt->fetch();
        if ($auth['role'] === 'buyer' && is_array($userSettings)) $userSettings['notify_processed_files']=0;
        respond(true,$userSettings,200);
    }
    if ($action === 'save_settings') {
        $lang=isset($input['language'])?(string)$input['language']:'ru'; if (!in_array($lang,array('ru','en','kz'),true)) $lang='ru';
        $theme=isset($input['theme'])?(string)$input['theme']:'mono'; if (!in_array($theme,array('mono','ocean','forest','rose','amber'),true)) $theme='mono';
        $appearance=isset($input['appearance'])?(string)$input['appearance']:'dark'; if (!in_array($appearance,array('dark','light'),true)) $appearance='dark';
        $u=(int)!empty($input['notify_updates']); $f=$auth['role']==='buyer' ? 0 : (int)!empty($input['notify_processed_files']); $s=(int)!empty($input['notify_subscription']);
        $privacyStmt=$pdo->prepare('SELECT seller_products_public,seller_dm_enabled FROM user_settings WHERE tg_id=? LIMIT 1');$privacyStmt->execute(array($tgId));$privacyCurrent=$privacyStmt->fetch()?:array('seller_products_public'=>0,'seller_dm_enabled'=>0);
        $sellerPublic=(int)!empty($privacyCurrent['seller_products_public']);$sellerDm=(int)!empty($privacyCurrent['seller_dm_enabled']);
        if ($auth['role']==='seller' || !empty($auth['is_admin'])) {
            if (array_key_exists('seller_products_public',$input)) $sellerPublic=(int)!empty($input['seller_products_public']);
            if (array_key_exists('seller_dm_enabled',$input)) $sellerDm=(int)!empty($input['seller_dm_enabled']);
        }
        $stmt=$pdo->prepare('INSERT INTO user_settings (tg_id,language,theme,appearance,notify_updates,notify_processed_files,notify_subscription,seller_products_public,seller_dm_enabled) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE language=VALUES(language),theme=VALUES(theme),appearance=VALUES(appearance),notify_updates=VALUES(notify_updates),notify_processed_files=VALUES(notify_processed_files),notify_subscription=VALUES(notify_subscription),seller_products_public=VALUES(seller_products_public),seller_dm_enabled=VALUES(seller_dm_enabled)'); $stmt->execute(array($tgId,$lang,$theme,$appearance,$u,$f,$s,$sellerPublic,$sellerDm));
        respond(true,array('saved'=>true,'seller_products_public'=>$sellerPublic,'seller_dm_enabled'=>$sellerDm),200);
    }
    if ($action === 'support') respond(true,array('developer_username'=>$config['developer_username'],'faq'=>array(array('q'=>'Как загрузить прайс-лист?','a'=>'Отправьте Excel или CSV документом боту. После обработки результаты появятся в приложении.'),array('q'=>'Почему часть строк требует проверки?','a'=>'Цена или название не распознаны однозначно. Такие значения сохраняются для ручной проверки.'),array('q'=>'Сколько времени обрабатывается один файл?','a'=>'Обычно обработка одного файла занимает примерно 3–5 минут. Время зависит от размера прайс-листа и количества строк.'),array('q'=>'Как обрабатываются конфликтные файлы?','a'=>'Если новый прайс-лист конфликтует с уже загруженным (например, это другая версия того же прайса), бот предложит выбрать действие для конфликтующих файлов. Чтобы обновление прошло максимально надёжно и заняло меньше времени, заранее удалите старый конфликтующий прайс-лист на странице «Прайс-листы», а затем загрузите новый.'),array('q'=>'Когда придёт напоминание о подписке?','a'=>'При включённых уведомлениях: за 72 часа до окончания и далее каждые 24 часа.'),array('q'=>'Какие форматы поддерживаются?','a'=>'.xls, .xlsx, .xlsm, .csv и .tsv.'))),200);
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
    require __DIR__ . '/actions/admin_users.php';
    if ($action === 'admin_stats') {
        admin_required($auth);
        $stats=array();
        $stats['maintenance']=maintenance_state($pdo);
        foreach (array('users'=>'SELECT COUNT(*) n FROM users','keys'=>'SELECT COUNT(*) n FROM subscription_keys','active_subscriptions'=>'SELECT COUNT(*) n FROM subscription_keys k WHERE k.available_until>NOW() AND k.is_frozen=0 AND k.id=(SELECT k2.id FROM subscription_keys k2 WHERE k2.used_by_tg_id=k.used_by_tg_id ORDER BY k2.activated_at DESC,k2.id DESC LIMIT 1)','price_lists'=>'SELECT COUNT(*) n FROM price_lists','products'=>'SELECT COUNT(*) n FROM products','review_rows'=>'SELECT COUNT(*) n FROM products WHERE needs_review=1') as $k=>$sql) { $stats[$k]=(int)$pdo->query($sql)->fetch()['n']; }
        $stmt=$pdo->query('SELECT id,key_prefix,key_hash,key_ciphertext,usable,duration_days,role_on_activate,used_by_tg_id,available_until,created_at FROM subscription_keys ORDER BY id DESC LIMIT 50'); $stats['keys_list']=$stmt->fetchAll();
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
        $stmt=$pdo->query('SELECT u.tg_id,u.username,u.first_name,u.last_name,u.photo_url,u.role,u.price_multiplier,u.is_blocked,u.banned_until,u.ban_reason,u.ban_details,k.available_until,k.is_frozen,EXISTS(SELECT 1 FROM admins a WHERE a.tg_id=u.tg_id) AS db_is_admin FROM users u LEFT JOIN subscription_keys k ON k.id=(SELECT k2.id FROM subscription_keys k2 WHERE k2.used_by_tg_id=u.tg_id ORDER BY k2.activated_at DESC,k2.id DESC LIMIT 1) ORDER BY u.created_at DESC LIMIT 100'); $stats['users_list']=$stmt->fetchAll();
        $configuredAdminIds=array_filter(array_map('trim',explode(',',(string)($config['admin_ids']??''))));
        foreach ($stats['users_list'] as &$userRow) {
            $userRow['role']=(!empty($userRow['db_is_admin']) || in_array((string)$userRow['tg_id'],$configuredAdminIds,true))?'admin':(in_array((string)$userRow['role'],array('buyer','seller','none'),true)?$userRow['role']:'none');
            unset($userRow['db_is_admin']);
        }
        unset($userRow);
        respond(true,$stats,200);
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
            $keyStmt=$pdo->prepare('SELECT id,duration_days,usable,used_by_tg_id,role_on_activate,key_prefix FROM subscription_keys WHERE id=? FOR UPDATE');$keyStmt->execute(array($keyId));$keyRow=$keyStmt->fetch();
            if(!$keyRow||empty($keyRow['usable'])||!empty($keyRow['used_by_tg_id'])){ $pdo->rollBack(); respond(false,array('error'=>'key_not_available','message'=>'Ключ уже использован или недоступен.'),409); }
            $pdo->prepare('UPDATE subscription_keys SET available_until=NOW(),is_frozen=0,frozen_at=NULL,frozen_remaining_sec=NULL WHERE used_by_tg_id=? AND available_until>NOW() AND is_frozen=0')->execute(array($target));
            $assign=$pdo->prepare('UPDATE subscription_keys SET usable=0,used_by_tg_id=?,activated_at=NOW(),available_until=DATE_ADD(NOW(),INTERVAL duration_days DAY),is_frozen=0,frozen_at=NULL,frozen_remaining_sec=NULL WHERE id=? AND usable=1 AND used_by_tg_id IS NULL');$assign->execute(array($target,$keyId));
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
    respond(false,array('error'=>'unknown_action'),400);
} catch (Throwable $e) {
    error_log('Basalt API error: '.$e->getMessage());
    respond(false,array('error'=>'server_error','message'=>'Ошибка сервера. Проверьте конфигурацию и схему базы данных.'),500);
}
