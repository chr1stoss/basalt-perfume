<?php
if (!defined('BP_PUBLIC_ROOT')) define('BP_PUBLIC_ROOT', dirname(__DIR__));
/* Telegram WebApp API, compatible with PHP 7.1. */
/* Keep warnings/fatal errors from leaking HTML into a JSON response. */
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);
if (ob_get_level() === 0) { ob_start(); }
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Frame-Options: DENY');
header('Cross-Origin-Resource-Policy: same-origin');

function api_fallback_json($errorCode, $message, $status) {
    while (ob_get_level() > 0) { @ob_end_clean(); }
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        header('X-Frame-Options: DENY');
        header('Cross-Origin-Resource-Policy: same-origin');
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
    // The web and bot projects are deployed as sibling folders. Keep the bot's
    // private .env outside the public web root and read only this one setting.
    $privateEnvCandidates = array(
        dirname(BP_PUBLIC_ROOT) . DIRECTORY_SEPARATOR . 'basalt-perfume-bot' . DIRECTORY_SEPARATOR . '.env',
        dirname(BP_PUBLIC_ROOT) . DIRECTORY_SEPARATOR . '.env'
    );
    foreach ($privateEnvCandidates as $privateEnvPath) {
        if (!is_file($privateEnvPath) || !is_readable($privateEnvPath)) continue;
        $lines = @file($privateEnvPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if (is_array($lines)) foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#' || strpos($line, '=') === false) continue;
            list($name, $value) = explode('=', $line, 2);
            if (trim($name) !== 'KEY_ENCRYPTION_SECRET') continue;
            $value = trim($value);
            if (strlen($value) >= 2 && (($value[0] === '"' && substr($value, -1) === '"') || ($value[0] === "'" && substr($value, -1) === "'"))) $value = substr($value, 1, -1);
            if ($value !== '') { putenv('KEY_ENCRYPTION_SECRET=' . $value); $_ENV['KEY_ENCRYPTION_SECRET'] = $value; $_SERVER['KEY_ENCRYPTION_SECRET'] = $value; }
            break 2;
        }
    }
}
$config = require BP_PUBLIC_ROOT . '/config/database.php';
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
require_once __DIR__ . '/lib/database.php';
require_once __DIR__ . '/lib/telegram.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/subscriptions.php';
require_once __DIR__ . '/lib/uploads.php';
require_once __DIR__ . '/lib/downloads.php';
