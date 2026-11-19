<?php
if ($action === 'browser_status') {
    $features = browser_features($pdo);
    $authenticated = false;
    $csrfToken = '';
    if (!empty($features['browser_access_enabled'])) {
        $authenticated = browser_session_is_authenticated();
        if ($authenticated) $csrfToken = browser_csrf_token(true);
    }
    $statusPayload = array_merge($features, array('authenticated'=>$authenticated, 'bot_username'=>$config['bot_username'], 'telegram_login_configured'=>telegram_oidc_configured($config)));
    if ($csrfToken !== '') $statusPayload['csrf_token'] = $csrfToken;
    respond(true, $statusPayload, 200);
}
if ($action === 'telegram_browser_nonce') {
    telegram_browser_login_nonce($config, $pdo, $input);
}
if ($action === 'telegram_browser_code_prepare') {
    telegram_browser_code_prepare($input, $config, $pdo);
}
if ($action === 'telegram_browser_verify') {
    telegram_browser_login_verify($input, $config, $pdo);
}
if ($action === 'telegram_oidc_start' || $action === 'telegram_oidc_callback') {
    respond(false, array('error'=>'legacy_oidc_flow_disabled','message'=>'Используется redirect-авторизация Telegram. Начните вход с главной страницы сайта.'), 410);
}
if ($action === 'telegram_login') {
    if (!app_setting_enabled($pdo, 'browser_access_enabled', false)) respond(false, array('error'=>'browser_access_disabled','message'=>'Доступ из браузера отключён администратором.'), 403);
    $user = validate_telegram_login_data(isset($input['auth_data']) ? $input['auth_data'] : null, $config['bot_token']);
    if (!$user) respond(false, array('error'=>'invalid_telegram_login','message'=>'Telegram не подтвердил вход. Обновите страницу и повторите авторизацию.'), 401);
    $auth = persist_telegram_user($user);
    start_browser_session();
    session_regenerate_id(true);
    $_SESSION['basalt_tg_id'] = (int)$auth['tg_id'];
    $_SESSION['basalt_expires_at'] = time() + 604800;
    $_SESSION['basalt_auth_source'] = 'telegram_login_widget';
    session_write_close();
    respond(true, array('logged_in'=>true, 'tg_id'=>(int)$auth['tg_id'], 'role'=>$auth['role'], 'is_admin'=>(bool)$auth['is_admin']), 200);
}
