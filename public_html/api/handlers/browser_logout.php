<?php
if ($action === 'browser_logout') {
    if (!empty($input['initData'])) respond(false, array('error'=>'browser_logout_browser_only','message'=>'Выход из браузерной сессии доступен только в обычном браузере.'), 403);
    if (!browser_session_is_authenticated()) respond(false, array('error'=>'browser_session_expired','message'=>'Сессия браузера завершилась. Войдите через Telegram ещё раз.'), 401);
    require_browser_csrf();
    // Reject cross-origin logout attempts; normal same-origin fetch sends the Origin header.
    $requestOrigin = isset($_SERVER['HTTP_ORIGIN']) ? rtrim((string)$_SERVER['HTTP_ORIGIN'], '/') : '';
    $siteParts = parse_url(isset($config['site_url']) ? (string)$config['site_url'] : '');
    if ($requestOrigin !== '' && is_array($siteParts) && !empty($siteParts['scheme']) && !empty($siteParts['host'])) {
        $expectedOrigin = strtolower($siteParts['scheme'] . '://' . $siteParts['host'] . (isset($siteParts['port']) ? ':' . $siteParts['port'] : ''));
        if (!hash_equals($expectedOrigin, strtolower($requestOrigin))) respond(false, array('error'=>'logout_origin_invalid','message'=>'Запрос выхода должен быть отправлен с основного сайта.'), 403);
    }
    if (isset($_SERVER['HTTP_SEC_FETCH_SITE']) && strtolower((string)$_SERVER['HTTP_SEC_FETCH_SITE']) === 'cross-site') respond(false, array('error'=>'logout_origin_invalid','message'=>'Межсайтовый запрос выхода отклонён.'), 403);
    start_browser_session();
    $_SESSION = array();
    if (ini_get('session.use_cookies')) {
        $cookieParams = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $cookieParams['path'], $cookieParams['domain'], $cookieParams['secure'], $cookieParams['httponly']);
    }
    session_destroy();
    respond(true, array('logged_out'=>true), 200);
}
