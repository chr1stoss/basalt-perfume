<?php
function app_setting_value($pdo, $key, $default = '') {
    $stmt = $pdo->prepare('SELECT setting_value FROM app_settings WHERE setting_key=? LIMIT 1');
    $stmt->execute(array((string)$key));
    $value = $stmt->fetchColumn();
    return $value === false ? (string)$default : (string)$value;
}
function app_setting_enabled($pdo, $key, $default = false) {
    return in_array(strtolower(trim(app_setting_value($pdo, $key, $default ? '1' : '0'))), array('1','true','yes','on'), true);
}
function browser_features($pdo) {
    return array(
        'browser_access_enabled' => app_setting_enabled($pdo, 'browser_access_enabled', false),
        'session_sync_enabled' => app_setting_enabled($pdo, 'session_sync_enabled', true),
        'web_price_upload_enabled' => true,
        'site_key_activation_enabled' => true
    );
}
function session_sync_state($pdo, $tgId, $input) {
    $mode = isset($input['mode']) ? (string)$input['mode'] : 'status';
    if (!in_array($mode, array('status','activity','claim','release'), true)) $mode = 'status';
    $clientId = isset($input['client_id']) ? (string)$input['client_id'] : '';
    if (!preg_match('/^[a-f0-9]{24,64}$/i', $clientId)) respond(false, array('error'=>'invalid_session_client','message'=>'Не удалось определить идентификатор сессии. Обновите приложение.'), 400);
    $requestedPlatform = isset($input['platform']) ? (string)$input['platform'] : 'mobile';
    $platform = in_array($requestedPlatform, array('desktop','mobile','mobile_browser','telegram_webapp'), true) ? $requestedPlatform : 'mobile';
    $enabled = app_setting_enabled($pdo, 'session_sync_enabled', true);
    if (!$enabled) return array('enabled'=>false,'active'=>true,'owner_platform'=>null,'expires_in'=>0);

    $key = 'session_sync_state_' . (string)((int)$tgId);
    $now = time(); $ttl = 120;
    $pdo->beginTransaction();
    try {
        // Create a lockable key row if this account has never used session synchronization.
        $insert = $pdo->prepare("INSERT IGNORE INTO app_settings(setting_key,setting_value) VALUES(?,?)");
        $insert->execute(array($key, '{}'));
        $lock = $pdo->prepare('SELECT setting_value FROM app_settings WHERE setting_key=? FOR UPDATE');
        $lock->execute(array($key));
        $raw = $lock->fetchColumn();
        $state = is_string($raw) ? json_decode($raw, true) : array();
        if (!is_array($state)) $state = array();
        $owner = isset($state['client_id']) ? (string)$state['client_id'] : '';
        $lastSeen = isset($state['last_seen']) ? (int)$state['last_seen'] : 0;
        $stale = ($owner === '' || $lastSeen < $now - $ttl);

        if ($mode === 'release') {
            if ($owner !== '' && hash_equals($owner, $clientId)) $state = array();
        } elseif ($mode === 'claim' || $stale) {
            $state = array('client_id'=>$clientId,'platform'=>$platform,'last_seen'=>$now);
        } elseif ($owner === $clientId) {
            $state['platform'] = $platform;
            $state['last_seen'] = $now;
        }
        $encoded = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $save = $pdo->prepare('UPDATE app_settings SET setting_value=? WHERE setting_key=?');
        $save->execute(array($encoded === false ? '{}' : $encoded, $key));
        $pdo->commit();
        $owner = isset($state['client_id']) ? (string)$state['client_id'] : '';
        $ownerPlatform = isset($state['platform']) ? (string)$state['platform'] : null;
        $lastSeen = isset($state['last_seen']) ? (int)$state['last_seen'] : 0;
        return array('enabled'=>true,'active'=>($mode === 'release' || $owner === $clientId),'owner_platform'=>$ownerPlatform,'expires_in'=>max(0, $ttl - ($now - $lastSeen)));
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

function start_browser_session() {
    global $config;
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $configuredHttps = isset($config['site_url']) && stripos((string)$config['site_url'], 'https://') === 0;
    $secure = $configuredHttps || (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off');
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', '604800');
    ini_set('session.cookie_httponly', '1');
    ini_set('session.cookie_secure', $secure ? '1' : '0');
    if (PHP_VERSION_ID >= 70300) ini_set('session.cookie_samesite', 'Lax');
    session_name('BASALTPERFUME');
    // Seven-day persistent HttpOnly cookie. The PHP session also stores its own expiry,
    // so stale sessions are rejected even if server-side session cleanup runs late.
    session_set_cookie_params(604800, '/', '', $secure, true);
    session_start();
}
function browser_session_is_authenticated() {
    start_browser_session();
    $tgId = isset($_SESSION['basalt_tg_id']) ? (int)$_SESSION['basalt_tg_id'] : 0;
    $expires = isset($_SESSION['basalt_expires_at']) ? (int)$_SESSION['basalt_expires_at'] : 0;
    if ($tgId < 1 || $expires < time()) {
        $_SESSION = array();
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
        }
        session_destroy();
        return false;
    }
    return true;
}
function browser_csrf_token($create = false) {
    if (session_status() !== PHP_SESSION_ACTIVE) start_browser_session();
    if (empty($_SESSION['basalt_csrf_token']) && $create) {
        $_SESSION['basalt_csrf_token'] = bin2hex(random_bytes(32));
    }
    return isset($_SESSION['basalt_csrf_token']) ? (string)$_SESSION['basalt_csrf_token'] : '';
}
function require_browser_csrf() {
    global $config;
    $expected = browser_csrf_token(false);
    $provided = isset($_SERVER['HTTP_X_CSRF_TOKEN']) ? (string)$_SERVER['HTTP_X_CSRF_TOKEN'] : '';
    if (strlen($expected) !== 64 || strlen($provided) !== 64 || !hash_equals($expected, $provided)) {
        respond(false, array('error'=>'csrf_validation_failed','message'=>'Сессия запроса устарела. Обновите страницу и повторите действие.'), 403);
    }
    $requestOrigin = isset($_SERVER['HTTP_ORIGIN']) ? rtrim((string)$_SERVER['HTTP_ORIGIN'], '/') : '';
    $siteParts = parse_url(isset($config['site_url']) ? (string)$config['site_url'] : '');
    if ($requestOrigin !== '' && is_array($siteParts) && !empty($siteParts['scheme']) && !empty($siteParts['host'])) {
        $expectedOrigin = strtolower($siteParts['scheme'] . '://' . $siteParts['host'] . (isset($siteParts['port']) ? ':' . $siteParts['port'] : ''));
        if (!hash_equals($expectedOrigin, strtolower($requestOrigin))) {
            respond(false, array('error'=>'csrf_origin_invalid','message'=>'Запрос отклонён: источник не совпадает с адресом сайта.'), 403);
        }
    }
    $fetchSite = isset($_SERVER['HTTP_SEC_FETCH_SITE']) ? strtolower((string)$_SERVER['HTTP_SEC_FETCH_SITE']) : '';
    if ($fetchSite === 'cross-site') {
        respond(false, array('error'=>'csrf_origin_invalid','message'=>'Межсайтовый запрос отклонён.'), 403);
    }
}
function resolve_user_auth($tgId, $userData = null) {
    global $config;
    $pdo = db();
    $stmt = $pdo->prepare('SELECT role FROM users WHERE tg_id=? LIMIT 1');
    $stmt->execute(array((int)$tgId));
    $role = strtolower(trim((string)$stmt->fetchColumn()));
    if ($role === '') respond(false, array('error'=>'user_not_found','message'=>'Профиль Telegram не найден.'), 401);
    // Apply a queued key's role only when that key becomes the current active segment.
    // This keeps role_on_activate from granting privileges before the queued period begins.
    if ($role === 'none') {
        $activeRoleStmt = $pdo->prepare('SELECT role_on_activate FROM subscription_keys WHERE used_by_tg_id=? AND starts_at<=NOW() AND available_until>NOW() AND is_frozen=0 ORDER BY starts_at DESC,id DESC LIMIT 1');
        $activeRoleStmt->execute(array((int)$tgId));
        $activeRole = strtolower(trim((string)$activeRoleStmt->fetchColumn()));
        if (in_array($activeRole, array('buyer','seller','admin'), true)) {
            $pdo->prepare('UPDATE users SET role=? WHERE tg_id=? AND role=\'none\'')->execute(array($activeRole,(int)$tgId));
            $role = $activeRole;
            if ($activeRole === 'admin') $pdo->prepare('INSERT IGNORE INTO admins(tg_id) VALUES(?)')->execute(array((int)$tgId));
        }
    }
    $isAdmin = false;
    $adminIds = array_filter(array_map('trim', explode(',', (string)($config['admin_ids'] ?? ''))));
    if (in_array((string)$tgId, $adminIds, true)) $isAdmin = true;
    $adminStmt = $pdo->prepare('SELECT tg_id FROM admins WHERE tg_id=?');
    $adminStmt->execute(array((int)$tgId));
    if ($adminStmt->fetch()) $isAdmin = true;
    // The legacy users.role='admin' value remains authoritative on older installations.
    if (!$isAdmin && $role === 'admin') $isAdmin = true;
    if ($isAdmin && in_array((string)$tgId, $adminIds, true)) {
        $pdo->prepare('INSERT IGNORE INTO admins(tg_id) VALUES(?)')->execute(array((int)$tgId));
        $pdo->prepare("UPDATE users SET role='admin' WHERE tg_id=?")->execute(array((int)$tgId));
    }
    if (!$isAdmin && !in_array($role, array('seller','buyer','none'), true)) $role = 'none';
    return array('tg_id'=>(int)$tgId, 'user'=>is_array($userData) ? $userData : array('id'=>(int)$tgId), 'is_admin'=>$isAdmin, 'role'=>$isAdmin ? 'admin' : $role);
}
function persist_telegram_user($user) {
    $pdo = db();
    $lang = isset($user['language_code']) ? strtolower(substr((string)$user['language_code'], 0, 2)) : 'ru';
    if ($lang === 'kk') $lang = 'kz';
    if (!in_array($lang, array('ru','en','kz'), true)) $lang = 'ru';
    $tgId = (int)$user['id'];
    $sourcePhoto = isset($user['photo_url']) ? substr((string)$user['photo_url'], 0, 500) : '';
    $existingStmt = $pdo->prepare('SELECT photo_url FROM users WHERE tg_id=? LIMIT 1');
    $existingStmt->execute(array($tgId));
    $existingPhoto = $existingStmt->fetchColumn();
    // Keep Telegram's signed picture URL as the source of truth. The local cached
    // copy is returned by cache_avatar, not written over this URL, so every page
    // open can retry/refresh the per-user cache after a temporary network failure.
    $photo = $sourcePhoto !== '' ? $sourcePhoto : ($existingPhoto ?: null);
    $username = isset($user['username']) ? $user['username'] : null;
    $firstName = isset($user['first_name']) ? $user['first_name'] : null;
    $lastName = isset($user['last_name']) ? $user['last_name'] : null;
    $stmt = $pdo->prepare("INSERT INTO users(tg_id,username,first_name,last_name,photo_url) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE username=?,first_name=?,last_name=?,photo_url=CASE WHEN ? <> '' THEN ? ELSE users.photo_url END");
    $stmt->execute(array($tgId,$username,$firstName,$lastName,$photo,$username,$firstName,$lastName,$sourcePhoto,$sourcePhoto));
    $stmt = $pdo->prepare('INSERT IGNORE INTO user_settings(tg_id,language) VALUES(?,?)');
    $stmt->execute(array($tgId, $lang));
    return resolve_user_auth($tgId, $user);
}
function validate_telegram_login_data($user, $botToken) {
    if (!is_array($user) || empty($user['id']) || empty($user['auth_date']) || empty($user['hash']) || !$botToken || $botToken === 'CHANGE_ME') return false;
    $authDate = (int)$user['auth_date'];
    if ($authDate < 1 || (time() - $authDate) > 86400 || $authDate > time() + 60) return false;
    $receivedHash = strtolower((string)$user['hash']);
    if (!preg_match('/^[a-f0-9]{64}$/', $receivedHash)) return false;
    unset($user['hash']);
    ksort($user, SORT_STRING);
    $parts = array();
    foreach ($user as $key => $value) {
        if (is_array($value) || is_object($value) || is_resource($value)) return false;
        $parts[] = $key . '=' . (string)$value;
    }
    $checkString = implode("\n", $parts);
    // Telegram Login Widget: SHA256(bot_token) is the HMAC secret key.
    $secretKey = hash('sha256', $botToken, true);
    $calculated = hash_hmac('sha256', $checkString, $secretKey);
    if (!hash_equals($calculated, $receivedHash)) return false;
    if (!ctype_digit((string)$user['id'])) return false;
    $user['id'] = (int)$user['id'];
    return $user;
}
/* Telegram Login: OpenID Connect Authorization Code Flow + PKCE. */
function telegram_oidc_base64url_decode($value) {
    $value = (string)$value;
    if ($value === '' || !preg_match('/^[A-Za-z0-9_-]+$/', $value)) return false;
    $base64 = strtr($value, '-_', '+/');
    $padding = strlen($base64) % 4;
    if ($padding) $base64 .= str_repeat('=', 4 - $padding);
    return base64_decode($base64, true);
}
function telegram_oidc_base64url_encode($value) {
    return rtrim(strtr(base64_encode((string)$value), '+/', '-_'), '=');
}
function telegram_oidc_configured($config) {
    // Redirect-based OIDC requires a public Client ID and a trusted HTTPS token-exchange relay.
    // The Client Secret lives only as a secret in that relay, never in PHP config or browser JS.
    $clientIdOk = !empty($config['telegram_login_client_id']) && preg_match('/^[0-9]{5,20}$/', (string)$config['telegram_login_client_id']);
    $relay = isset($config['telegram_login_exchange_relay_url']) ? trim((string)$config['telegram_login_exchange_relay_url']) : '';
    $relayOk = $relay !== '' && filter_var($relay, FILTER_VALIDATE_URL) && stripos($relay, 'https://') === 0;
    return $clientIdOk && $relayOk;
}
function telegram_oidc_der_length($length) {
    $length = (int)$length;
    if ($length < 128) return chr($length);
    $bytes = '';
    while ($length > 0) { $bytes = chr($length & 255) . $bytes; $length = $length >> 8; }
    return chr(128 | strlen($bytes)) . $bytes;
}
function telegram_oidc_der_integer($bytes) {
    $bytes = ltrim((string)$bytes, "\x00");
    if ($bytes === '') $bytes = "\x00";
    if ((ord($bytes[0]) & 128) !== 0) $bytes = "\x00" . $bytes;
    return "\x02" . telegram_oidc_der_length(strlen($bytes)) . $bytes;
}
function telegram_oidc_jwk_public_pem($modulus, $exponent) {
    $n = telegram_oidc_base64url_decode($modulus);
    $e = telegram_oidc_base64url_decode($exponent);
    if ($n === false || $e === false) return false;
    $rsaPublicKey = "\x30" . telegram_oidc_der_length(strlen(telegram_oidc_der_integer($n) . telegram_oidc_der_integer($e))) . telegram_oidc_der_integer($n) . telegram_oidc_der_integer($e);
    $bitString = "\x03" . telegram_oidc_der_length(strlen($rsaPublicKey) + 1) . "\x00" . $rsaPublicKey;
    $algorithmIdentifier = hex2bin('300d06092a864886f70d0101010500');
    if ($algorithmIdentifier === false) return false;
    $subjectPublicKeyInfoContent = $algorithmIdentifier . $bitString;
    $subjectPublicKeyInfo = "\x30" . telegram_oidc_der_length(strlen($subjectPublicKeyInfoContent)) . $subjectPublicKeyInfoContent;
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($subjectPublicKeyInfo), 64, "\n") . "-----END PUBLIC KEY-----\n";
}
function telegram_oidc_validate_id_token($jwt, $clientId, $expectedNonce) {
    if (!is_string($jwt)) return false;
    $parts = explode('.', $jwt);
    if (count($parts) !== 3) return false;
    $headerJson = telegram_oidc_base64url_decode($parts[0]);
    $claimsJson = telegram_oidc_base64url_decode($parts[1]);
    $signature = telegram_oidc_base64url_decode($parts[2]);
    if ($headerJson === false || $claimsJson === false || $signature === false) return false;
    $header = json_decode($headerJson, true);
    $claims = json_decode($claimsJson, true);
    if (!is_array($header) || !is_array($claims) || empty($header['alg']) || $header['alg'] !== 'RS256') return false;
    if (empty($header['kid']) || empty($claims['iss']) || $claims['iss'] !== 'https://oauth.telegram.org') return false;
    if (!isset($claims['aud'])) return false;
    $audiences = is_array($claims['aud']) ? $claims['aud'] : array((string)$claims['aud']);
    if (!in_array((string)$clientId, array_map('strval', $audiences), true)) return false;
    if (isset($claims['azp']) && (string)$claims['azp'] !== (string)$clientId) return false;
    if (empty($claims['exp']) || (int)$claims['exp'] <= time()) return false;
    if (empty($claims['iat']) || (int)$claims['iat'] > time() + 60 || (int)$claims['iat'] < time() - 86400) return false;
    if (isset($claims['nbf']) && (int)$claims['nbf'] > time() + 60) return false;
    if (empty($claims['nonce']) || !hash_equals((string)$expectedNonce, (string)$claims['nonce'])) return false;
    if (empty($claims['sub'])) return false;
    $jwksPath = BP_PUBLIC_ROOT . '/config/telegram-jwks.json';
    if (!is_file($jwksPath) || !is_readable($jwksPath)) return false;
    $jwksRaw = @file_get_contents($jwksPath);
    $jwks = is_string($jwksRaw) ? json_decode($jwksRaw, true) : null;
    if (!is_array($jwks) || empty($jwks['keys']) || !is_array($jwks['keys'])) return false;
    $matchingKey = null;
    foreach ($jwks['keys'] as $key) {
        if (is_array($key) && isset($key['kid']) && (string)$key['kid'] === (string)$header['kid'] && isset($key['kty']) && $key['kty'] === 'RSA') { $matchingKey = $key; break; }
    }
    if (!$matchingKey || empty($matchingKey['n']) || empty($matchingKey['e'])) return false;
    if (isset($matchingKey['alg']) && $matchingKey['alg'] !== 'RS256') return false;
    $publicPem = telegram_oidc_jwk_public_pem($matchingKey['n'], $matchingKey['e']);
    if ($publicPem === false || !function_exists('openssl_verify')) return false;
    $verified = @openssl_verify($parts[0] . '.' . $parts[1], $signature, $publicPem, OPENSSL_ALGO_SHA256);
    if ($verified !== 1) return false;
    return $claims;
}
function telegram_oidc_user_from_claims($claims) {
    if (!is_array($claims)) return false;
    $id = isset($claims['id']) ? (string)$claims['id'] : (isset($claims['sub']) ? (string)$claims['sub'] : '');
    if ($id === '' || !ctype_digit($id) || (float)$id <= 0) return false;
    $firstName = isset($claims['given_name']) ? trim((string)$claims['given_name']) : (isset($claims['name']) ? trim((string)$claims['name']) : '');
    $lastName = isset($claims['family_name']) ? trim((string)$claims['family_name']) : '';
    return array(
        'id'=>(int)$id,
        'username'=>isset($claims['preferred_username']) ? substr((string)$claims['preferred_username'], 0, 64) : null,
        'first_name'=>$firstName !== '' ? substr($firstName, 0, 128) : null,
        'last_name'=>$lastName !== '' ? substr($lastName, 0, 128) : null,
        'photo_url'=>isset($claims['picture']) ? substr((string)$claims['picture'], 0, 500) : null,
        'language_code'=>'ru'
    );
}
/* Telegram Login redirect flow: browser navigates top-level to Telegram, then
 * receives an authorization code on telegram-login-callback.html. A trusted edge
 * relay exchanges that code; PHP only issues a one-time nonce and verifies the
 * returned signed ID token locally. The PHP host needs no Telegram egress.
 */
function telegram_browser_login_nonce($config, $pdo, $input) {
    if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '') !== 'POST') {
        respond(false, array('error'=>'method_not_allowed','message'=>'Для входа используйте POST-запрос.'), 405);
    }
    if (!app_setting_enabled($pdo, 'browser_access_enabled', false)) {
        respond(false, array('error'=>'browser_access_disabled','message'=>'Доступ из браузера отключён администратором.'), 403);
    }
    if (!telegram_oidc_configured($config)) {
        respond(false, array('error'=>'telegram_login_not_configured','message'=>'Не настроены Telegram Client ID или адрес защищённого HTTPS relay для обмена кода.'), 503);
    }
    if (!function_exists('random_bytes') || !function_exists('openssl_verify')) {
        respond(false, array('error'=>'server_crypto_unavailable','message'=>'На сервере недоступны необходимые криптографические функции PHP.'), 503);
    }
    start_browser_session();
    // One active OIDC transaction per browser session. State + PKCE verifier are
    // kept server-side so a callback opened in a new tab by the OS still works.
    $nonce = telegram_oidc_base64url_encode(random_bytes(32));
    $state = telegram_oidc_base64url_encode(random_bytes(32));
    $codeVerifier = telegram_oidc_base64url_encode(random_bytes(32));
    $codeChallenge = telegram_oidc_base64url_encode(hash('sha256', $codeVerifier, true));
    $returnTo = isset($input['return_to']) ? (string)$input['return_to'] : '/';
    if ($returnTo === '' || $returnTo[0] !== '/' || strpos($returnTo, '//') === 0 || strpos($returnTo, '\\') !== false || strpos($returnTo, '/telegram-login-callback.html') === 0) $returnTo = '/';
    $_SESSION['telegram_browser_nonce'] = $nonce;
    $_SESSION['telegram_browser_nonce_issued_at'] = time();
    $_SESSION['telegram_browser_state'] = $state;
    $_SESSION['telegram_browser_code_verifier'] = $codeVerifier;
    $_SESSION['telegram_browser_return_to'] = $returnTo;
    session_write_close();
    $siteUrl = isset($config['site_url']) ? rtrim((string)$config['site_url'], '/') : '';
    if (stripos($siteUrl, 'https://') !== 0 || !filter_var($siteUrl, FILTER_VALIDATE_URL)) {
        respond(false, array('error'=>'site_url_must_be_https','message'=>'В config/database.php укажите канонический HTTPS site_url.'), 503);
    }
    respond(true, array(
        'client_id'=>(string)$config['telegram_login_client_id'],
        'nonce'=>$nonce,
        'state'=>$state,
        'code_challenge'=>$codeChallenge,
        'redirect_uri'=>$siteUrl . '/telegram-login-callback.html',
        'exchange_relay_url'=>rtrim((string)$config['telegram_login_exchange_relay_url'], '/'),
        'expires_in'=>600
    ), 200);
}
function telegram_browser_code_prepare($input, $config, $pdo) {
    if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '') !== 'POST') {
        respond(false, array('error'=>'method_not_allowed','message'=>'Для возврата из Telegram используйте POST-запрос.'), 405);
    }
    if (!app_setting_enabled($pdo, 'browser_access_enabled', false)) {
        respond(false, array('error'=>'browser_access_disabled','message'=>'Доступ из браузера отключён администратором.'), 403);
    }
    if (!telegram_oidc_configured($config)) {
        respond(false, array('error'=>'telegram_login_not_configured','message'=>'Не настроены Client ID или HTTPS relay.'), 503);
    }
    $state = isset($input['state']) ? (string)$input['state'] : '';
    $code = isset($input['code']) ? trim((string)$input['code']) : '';
    if ($state === '' || $code === '' || strlen($code) > 4096) {
        respond(false, array('error'=>'telegram_callback_invalid','message'=>'Telegram вернул неполный callback. Начните вход заново.'), 400);
    }
    start_browser_session();
    $expectedState = isset($_SESSION['telegram_browser_state']) ? (string)$_SESSION['telegram_browser_state'] : '';
    $issuedAt = isset($_SESSION['telegram_browser_nonce_issued_at']) ? (int)$_SESSION['telegram_browser_nonce_issued_at'] : 0;
    $verifier = isset($_SESSION['telegram_browser_code_verifier']) ? (string)$_SESSION['telegram_browser_code_verifier'] : '';
    $returnTo = isset($_SESSION['telegram_browser_return_to']) ? (string)$_SESSION['telegram_browser_return_to'] : '/';
    if ($expectedState === '' || !hash_equals($expectedState, $state) || $verifier === '' || $issuedAt < time() - 600 || $issuedAt > time() + 60) {
        session_write_close();
        respond(false, array('error'=>'telegram_login_state_expired','message'=>'Защита state/PKCE не прошла или срок входа истёк. Начните авторизацию заново.'), 401);
    }
    // Consume state/verifier before code exchange. The nonce remains for ID-token validation.
    unset($_SESSION['telegram_browser_state'], $_SESSION['telegram_browser_code_verifier'], $_SESSION['telegram_browser_return_to']);
    session_write_close();
    $siteUrl = isset($config['site_url']) ? rtrim((string)$config['site_url'], '/') : '';
    respond(true, array(
        'client_id'=>(string)$config['telegram_login_client_id'],
        'code_verifier'=>$verifier,
        'redirect_uri'=>$siteUrl . '/telegram-login-callback.html',
        'exchange_relay_url'=>rtrim((string)$config['telegram_login_exchange_relay_url'], '/'),
        'return_to'=>$returnTo
    ), 200);
}
function telegram_browser_login_verify($input, $config, $pdo) {
    if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '') !== 'POST') {
        respond(false, array('error'=>'method_not_allowed','message'=>'Для завершения входа используйте POST-запрос.'), 405);
    }
    if (!app_setting_enabled($pdo, 'browser_access_enabled', false)) {
        respond(false, array('error'=>'browser_access_disabled','message'=>'Доступ из браузера отключён администратором.'), 403);
    }
    if (!telegram_oidc_configured($config)) {
        respond(false, array('error'=>'telegram_login_not_configured','message'=>'Не указан корректный Telegram Client ID.'), 503);
    }
    $idToken = isset($input['id_token']) ? trim((string)$input['id_token']) : '';
    if ($idToken === '' || strlen($idToken) > 32768) {
        respond(false, array('error'=>'telegram_id_token_missing','message'=>'Браузер не передал ID-токен Telegram. Повторите вход.'), 400);
    }
    start_browser_session();
    $expectedNonce = isset($_SESSION['telegram_browser_nonce']) ? (string)$_SESSION['telegram_browser_nonce'] : '';
    $issuedAt = isset($_SESSION['telegram_browser_nonce_issued_at']) ? (int)$_SESSION['telegram_browser_nonce_issued_at'] : 0;
    // Consume nonce before verification to prevent replay, including failed attempts.
    unset($_SESSION['telegram_browser_nonce'], $_SESSION['telegram_browser_nonce_issued_at']);
    session_write_close();
    if ($expectedNonce === '' || $issuedAt < time() - 600 || $issuedAt > time() + 60) {
        respond(false, array('error'=>'telegram_login_nonce_expired','message'=>'Срок подготовки входа истёк. Обновите страницу и повторите попытку.'), 401);
    }
    $claims = telegram_oidc_validate_id_token($idToken, (string)$config['telegram_login_client_id'], $expectedNonce);
    if (!$claims) {
        error_log('Basalt Telegram Login: received ID token failed local RS256/JWKS/claims verification.');
        respond(false, array('error'=>'telegram_id_token_invalid','message'=>'Сервер не смог проверить подпись или данные токена Telegram. Проверьте локальный JWKS и RS256.'), 401);
    }
    $user = telegram_oidc_user_from_claims($claims);
    if (!$user) {
        respond(false, array('error'=>'telegram_profile_invalid','message'=>'В подписанном токене Telegram отсутствуют необходимые данные профиля.'), 401);
    }
    try {
        $auth = persist_telegram_user($user);
    } catch (Throwable $e) {
        error_log('Basalt Telegram Login SDK: user persistence failed: ' . get_class($e));
        respond(false, array('error'=>'telegram_user_persist_failed','message'=>'Не удалось сохранить профиль Telegram в базе данных.'), 500);
    }
    if (!$auth || empty($auth['tg_id'])) {
        respond(false, array('error'=>'telegram_user_persist_failed','message'=>'Не удалось сохранить профиль Telegram в базе данных.'), 500);
    }
    start_browser_session();
    session_regenerate_id(true);
    $_SESSION['basalt_tg_id'] = (int)$auth['tg_id'];
    $_SESSION['basalt_expires_at'] = time() + 604800;
    $_SESSION['basalt_auth_source'] = 'telegram_login_sdk';
    session_write_close();
    respond(true, array('logged_in'=>true, 'tg_id'=>(int)$auth['tg_id'], 'role'=>$auth['role'], 'is_admin'=>(bool)$auth['is_admin']), 200);
}

function browser_current_user() {
    $pdo = db();
    if (!app_setting_enabled($pdo, 'browser_access_enabled', false)) {
        respond(false, array('error'=>'browser_access_disabled','message'=>'Доступ из обычного браузера отключён. Откройте приложение через Telegram.'), 403);
    }
    if (!browser_session_is_authenticated()) {
        respond(false, array('error'=>'browser_session_expired','message'=>'Сессия браузера завершилась. Войдите через Telegram ещё раз.'), 401);
    }
    require_browser_csrf();
    return resolve_user_auth((int)$_SESSION['basalt_tg_id']);
}

function current_user($data) {
    global $config;
    $initData = isset($data['initData']) ? (string)$data['initData'] : '';
    if ($initData === '') return browser_current_user();
    $user = validate_init_data($initData, $config['bot_token']);
    if (!$user) respond(false, array('error' => 'invalid_telegram_init_data', 'message' => 'Откройте приложение из Telegram.'), 401);
    // Never call Telegram/CDN from the authentication-critical request; the signed photo URL is stored as-is.
    return persist_telegram_user($user);
}
function subscription_for($tgId) {
    $pdo = db();
    $stmt = $pdo->prepare("SELECT id,key_prefix,activated_at,starts_at,available_until,is_frozen,frozen_remaining_sec,duration_days,(starts_at<=NOW() AND available_until>NOW() AND is_frozen=0) AS active,GREATEST(TIMESTAMPDIFF(SECOND,NOW(),available_until),0) AS seconds_left,GREATEST(TIMESTAMPDIFF(SECOND,starts_at,available_until),duration_days*86400,1) AS duration_seconds FROM subscription_keys WHERE used_by_tg_id=? AND starts_at<=NOW() AND available_until>NOW() AND is_frozen=0 ORDER BY starts_at DESC,id DESC LIMIT 1");
    $stmt->execute(array($tgId));
    $row = $stmt->fetch();
    if (!$row) {
        $fallback = $pdo->prepare('SELECT id,key_prefix,activated_at,starts_at,available_until,is_frozen,frozen_remaining_sec,duration_days,0 AS active,0 AS seconds_left,GREATEST(TIMESTAMPDIFF(SECOND,starts_at,available_until),duration_days*86400,1) AS duration_seconds FROM subscription_keys WHERE used_by_tg_id=? ORDER BY COALESCE(starts_at,activated_at) DESC,id DESC LIMIT 1');
        $fallback->execute(array($tgId));
        $row = $fallback->fetch();
    }
    if (!$row) return null;
    $queuedStmt = $pdo->prepare('SELECT id,key_prefix,starts_at,available_until,duration_days FROM subscription_keys WHERE used_by_tg_id=? AND starts_at>NOW() AND available_until>NOW() AND is_frozen=0 ORDER BY starts_at ASC,id ASC');
    $queuedStmt->execute(array($tgId));
    $row['queued'] = $queuedStmt->fetchAll();
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
