<?php
function schedule_telegram_notification_cleanup($chatId, $messageId, $notificationId) {
    try {
        $stmt=db()->prepare('INSERT IGNORE INTO telegram_message_cleanup(chat_id,message_id,notification_id,delete_after) VALUES(?,?,?,DATE_ADD(NOW(),INTERVAL 1 MINUTE))');
        $stmt->execute(array((int)$chatId,(int)$messageId,(int)$notificationId));
    } catch (Exception $e) { error_log('Basalt notification cleanup scheduling failed: ' . $e->getMessage()); }
}
function send_telegram_photo_notification($config, $chatId, $title, $message, $notificationId) {
    if (empty($config['bot_token'])) return false;
    $image = BP_PUBLIC_ROOT . '/assets/img/logo.jpg';
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
    foreach ($_POST as $key => $value) { if (!isset($json[$key])) $json[$key] = $value; }
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
function avatar_upload_directory($tgId = null) {
    $root = BP_PUBLIC_ROOT . '/uploads/avatars';
    if ($tgId === null || (int)$tgId < 1) return $root;
    return $root . '/' . hash('sha256', (string)(int)$tgId);
}
function avatar_url_is_local($url) {
    return is_string($url) && preg_match('~^/uploads/avatars/(?:[a-f0-9]{64}/)?[a-f0-9]{64}\.(?:jpg|jpeg|png|webp|svg)$~i', $url) === 1;
}

function telegram_avatar_host_allowed($host) {
    $host = strtolower((string)$host);
    return $host === 't.me' || $host === 'telegram.org' || $host === 'telegram-cdn.org'
        || $host === 'cdn-telegram.org' || $host === 'telesco.pe'
        || substr($host, -13) === '.telegram.org'
        || substr($host, -17) === '.telegram-cdn.org'
        || substr($host, -17) === '.cdn-telegram.org'
        || (strlen($host) > strlen('.telesco.pe') && substr($host, -strlen('.telesco.pe')) === '.telesco.pe');
}
function avatar_host_matches_allowlist($host, $allowedHosts) {
    $host = strtolower((string)$host);
    foreach ($allowedHosts as $allowedHost) {
        $allowedHost = strtolower((string)$allowedHost);
        if ($allowedHost === '') continue;
        if ($allowedHost[0] === '.') {
            if (strlen($host) > strlen($allowedHost) && substr($host, -strlen($allowedHost)) === $allowedHost) return true;
        } elseif ($host === $allowedHost) {
            return true;
        }
    }
    return false;
}
function resolve_avatar_redirect_url($baseUrl, $location) {
    $location = trim((string)$location);
    if ($location === '') return null;
    if (preg_match('~^https://~i', $location)) return $location;
    if (strpos($location, '//') === 0) return 'https:' . $location;
    $base = parse_url((string)$baseUrl);
    if (!$base || empty($base['host'])) return null;
    $origin = 'https://' . $base['host'] . (isset($base['port']) ? ':' . (int)$base['port'] : '');
    if (isset($location[0]) && $location[0] === '/') return $origin . $location;
    if (isset($location[0]) && $location[0] === '?') return $origin . (isset($base['path']) ? $base['path'] : '/') . $location;
    $basePath = isset($base['path']) ? $base['path'] : '/';
    $directory = substr($basePath, 0, strrpos($basePath, '/') !== false ? strrpos($basePath, '/') + 1 : 0);
    return $origin . $directory . $location;
}
function download_avatar_bytes($url, $allowedHosts) {
    if (!function_exists('curl_init')) return null;
    $currentUrl = (string)$url;
    $maxRedirects = 4;
    for ($redirect = 0; $redirect <= $maxRedirects; $redirect++) {
        $parts = parse_url($currentUrl);
        if (!$parts || strtolower(isset($parts['scheme']) ? $parts['scheme'] : '') !== 'https' || empty($parts['host'])) return null;
        if (isset($parts['user']) || isset($parts['pass']) || (isset($parts['port']) && (int)$parts['port'] !== 443)) return null;
        $host = strtolower($parts['host']);
        if (!avatar_host_matches_allowlist($host, $allowedHosts)) return null;

        $body = '';
        $location = '';
        $ch = curl_init($currentUrl);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
        curl_setopt($ch, CURLOPT_TIMEOUT, 7);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
        curl_setopt($ch, CURLOPT_USERAGENT, 'BasaltPerfumeAvatarCache/1.1');
        if (defined('CURLOPT_PROTOCOLS') && defined('CURLPROTO_HTTPS')) curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
        curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($handle, $headerLine) use (&$location) {
            $length = strlen($headerLine);
            if (stripos($headerLine, 'Location:') === 0) $location = trim(substr($headerLine, 9));
            return $length;
        });
        curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($handle, $chunk) use (&$body) {
            if (strlen($body) + strlen($chunk) > 4 * 1024 * 1024) return 0;
            $body .= $chunk;
            return strlen($chunk);
        });
        $downloadOk = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($downloadOk === false) return null;

        if (in_array($status, array(301, 302, 303, 307, 308), true)) {
            if ($location === '' || $redirect >= $maxRedirects) return null;
            $nextUrl = resolve_avatar_redirect_url($currentUrl, $location);
            if (!$nextUrl) return null;
            $currentUrl = $nextUrl;
            continue;
        }
        if ($status !== 200 || strlen($body) < 1) return null;
        $info = function_exists('getimagesizefromstring') ? @getimagesizefromstring($body) : false;
        if (!$info || empty($info['mime']) || empty($info[0]) || empty($info[1]) || $info[0] > 4096 || $info[1] > 4096) return null;
        $extensions = array('image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp');
        if (!isset($extensions[$info['mime']])) return null;
        return array('body' => $body, 'extension' => $extensions[$info['mime']]);
    }
    return null;
}
function save_cached_avatar($tgId, $cacheSeed, $image) {
    if (!is_array($image) || empty($image['body']) || empty($image['extension'])) return null;
    $dir = avatar_upload_directory($tgId);
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) return null;
    $hash = hash('sha256', (string)$tgId . "\0" . (string)$cacheSeed);
    $filename = $hash . '.' . $image['extension'];
    $target = $dir . '/' . $filename;
    $temp = $target . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (@file_put_contents($temp, $image['body'], LOCK_EX) === false) { @unlink($temp); return null; }
    @chmod($temp, 0644);
    if (!@rename($temp, $target)) { @unlink($temp); return null; }
    return '/uploads/avatars/' . hash('sha256', (string)(int)$tgId) . '/' . $filename;
}
function cache_telegram_avatar_from_url($tgId, $url, $forceRefresh = false) {
    if (!is_string($url) || $url === '') return null;
    $parts = parse_url($url);
    if (!$parts || !isset($parts['host']) || !telegram_avatar_host_allowed($parts['host'])) return null;
    $seed = hash('sha256', $url);
    $dir = avatar_upload_directory($tgId);
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) return null;
    $cacheHash = hash('sha256', (string)$tgId . "\0" . $seed);
    $existingUrl = null;
    foreach (array('jpg', 'png', 'webp') as $extension) {
        $existing = $dir . '/' . $cacheHash . '.' . $extension;
        if (is_file($existing) && @filesize($existing) > 0) {
            $existingUrl = '/uploads/avatars/' . hash('sha256', (string)(int)$tgId) . '/' . basename($existing);
            if (!$forceRefresh) return $existingUrl;
            break;
        }
    }
    $failureMarker = $dir . '/' . $cacheHash . '.failed';
    if (!$forceRefresh && is_file($failureMarker) && (time() - (int)filemtime($failureMarker)) < 600) return $existingUrl;
    $image = download_avatar_bytes($url, array('t.me', 'telegram.org', '.telegram.org', 'telegram-cdn.org', '.telegram-cdn.org', 'cdn-telegram.org', '.cdn-telegram.org', 'telesco.pe', '.telesco.pe'));
    if (!$image) {
        if (!$forceRefresh && is_dir($dir)) @file_put_contents($failureMarker, (string)time(), LOCK_EX);
        return $existingUrl;
    }
    @unlink($failureMarker);
    $savedUrl = save_cached_avatar($tgId, $seed, $image);
    return $savedUrl ? $savedUrl : $existingUrl;
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

function cache_telegram_avatar_from_bot_api($tgId, $config, $forceRefresh = false) {
    $dir = avatar_upload_directory($tgId);
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) return null;
    $failureMarker = $dir . '/' . hash('sha256', (string)$tgId . "\0telegram-bot-api") . '.bot-failed';
    if (!$forceRefresh && is_file($failureMarker) && (time() - (int)filemtime($failureMarker)) < 86400) return null;
    $markFailure = function () use ($dir, $failureMarker, $forceRefresh) {
        if (!$forceRefresh && is_dir($dir)) @file_put_contents($failureMarker, (string)time(), LOCK_EX);
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
