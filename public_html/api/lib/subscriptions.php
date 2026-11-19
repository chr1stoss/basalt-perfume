<?php
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
