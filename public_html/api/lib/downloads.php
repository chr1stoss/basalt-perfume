<?php
function zip_write_all($handle, $bytes) {
    $length = strlen($bytes); $offset = 0;
    while ($offset < $length) { $written = fwrite($handle, substr($bytes, $offset)); if ($written === false || $written === 0) return false; $offset += $written; }
    return true;
}
function download_all_web_price_lists($pdo, $auth, $config, $input) {
    require_seller_or_admin($auth);
    if (empty($auth['is_admin'])) require_active_subscription($auth['tg_id']);
    $ownerId = (int)$auth['tg_id'];
    if (!empty($auth['is_admin']) && isset($input['user_id'])) $ownerId = (int)$input['user_id'];
    $stmt = $pdo->prepare("SELECT filename,filepath,size_bytes FROM price_lists WHERE owner_tg_id=? AND status='ready' ORDER BY imported_at DESC,id DESC");
    $stmt->execute(array($ownerId));
    $files = $stmt->fetchAll();
    if (!$files) respond(false,array('error'=>'no_ready_files','message'=>'Нет готовых прайс-листов для скачивания.'),404);
    $storage = configured_web_upload_storage_dir($config);
    $allowedRoots = array();
    $newRoot = realpath($storage); if ($newRoot !== false) $allowedRoots[] = rtrim($newRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
    if (!empty($config['price_list_storage_dir'])) { $legacyRoot = realpath((string)$config['price_list_storage_dir']); if ($legacyRoot !== false) $allowedRoots[] = rtrim($legacyRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR; }
    $tmp = tempnam(sys_get_temp_dir(), 'bp-files-');
    if ($tmp === false) respond(false,array('error'=>'archive_temp_unavailable','message'=>'Не удалось подготовить временный архив на сервере.'),500);
    $handle = @fopen($tmp, 'wb');
    if (!$handle) { @unlink($tmp); respond(false,array('error'=>'archive_create_failed','message'=>'Не удалось создать архив прайс-листов.'),500); }
    $central = array(); $added = 0; $usedNames = array(); $localOffset = 0; $totalBytes = 0;
    $now = getdate(); $dosTime = (($now['hours'] & 31) << 11) | (($now['minutes'] & 63) << 5) | ((int)($now['seconds'] / 2));
    $dosDate = ((max(1980,(int)$now['year']) - 1980) << 9) | (($now['mon'] & 15) << 5) | ($now['mday'] & 31);
    foreach ($files as $file) {
        $path = realpath((string)$file['filepath']); $allowed = false;
        if ($path !== false) foreach ($allowedRoots as $allowedRoot) { if (strpos($path, $allowedRoot) === 0) { $allowed = true; break; } }
        if (!$allowed || !is_file($path)) continue;
        $size = (int)filesize($path); if ($size < 1) continue;
        $totalBytes += $size;
        if ($totalBytes > 3500000000 || $added >= 65534) { fclose($handle); @unlink($tmp); respond(false,array('error'=>'archive_too_large','message'=>'Суммарный размер файлов слишком велик для одного ZIP-архива. Скачайте часть файлов отдельно.'),413); }
        $name = safe_price_filename($file['filename']); $base = $name; $n = 1;
        while (isset($usedNames[strtolower($name)])) { $ext = pathinfo($base, PATHINFO_EXTENSION); $stem = pathinfo($base, PATHINFO_FILENAME); $name = $stem . ' (' . (++$n) . ')' . ($ext !== '' ? '.' . $ext : ''); }
        $usedNames[strtolower($name)] = true; $nameBytes = $name;
        $crcHex = hash_file('crc32b', $path); $crc = (int)hexdec($crcHex);
        $source = @fopen($path, 'rb');
        if (!$source) continue;
        $header = pack('VvvvvvVVVvv', 0x04034b50, 20, 0x0800, 0, $dosTime, $dosDate, $crc, $size, $size, strlen($nameBytes), 0) . $nameBytes;
        if (!zip_write_all($handle, $header)) { fclose($source); fclose($handle); @unlink($tmp); respond(false,array('error'=>'archive_write_failed','message'=>'Не удалось записать ZIP-архив.'),500); }
        $copyOk = true;
        while (!feof($source)) { $chunk = fread($source, 1024 * 1024); if ($chunk === false) { $copyOk = false; break; } if ($chunk !== '' && !zip_write_all($handle, $chunk)) { $copyOk = false; break; } }
        fclose($source);
        if (!$copyOk) { fclose($handle); @unlink($tmp); respond(false,array('error'=>'archive_write_failed','message'=>'Не удалось добавить файл в ZIP-архив.'),500); }
        $central[] = pack('VvvvvvvVVVvvvvvVV', 0x02014b50, 20, 20, 0x0800, 0, $dosTime, $dosDate, $crc, $size, $size, strlen($nameBytes), 0, 0, 0, 0, 0, $localOffset) . $nameBytes;
        $localOffset += strlen($header) + $size; $added++;
    }
    if ($added < 1) { fclose($handle); @unlink($tmp); respond(false,array('error'=>'archive_empty','message'=>'Не удалось добавить доступные файлы в архив.'),404); }
    $centralOffset = $localOffset; $centralSize = 0;
    foreach ($central as $record) { if (!zip_write_all($handle, $record)) { fclose($handle); @unlink($tmp); respond(false,array('error'=>'archive_write_failed','message'=>'Не удалось завершить ZIP-архив.'),500); } $centralSize += strlen($record); }
    $endRecord = pack('VvvvvVVv', 0x06054b50, 0, 0, $added, $added, $centralSize, $centralOffset, 0);
    if (!zip_write_all($handle, $endRecord)) { fclose($handle); @unlink($tmp); respond(false,array('error'=>'archive_write_failed','message'=>'Не удалось завершить ZIP-архив.'),500); }
    fclose($handle);
    if (!is_file($tmp) || filesize($tmp) < 1) { @unlink($tmp); respond(false,array('error'=>'archive_empty','message'=>'Не удалось создать ZIP-архив.'),500); }
    while (ob_get_level() > 0) @ob_end_clean();
    header_remove('Content-Type'); header('Content-Type: application/zip');
    header('Content-Length: ' . (string)filesize($tmp));
    header('Content-Disposition: attachment; filename="basalt-price-lists.zip"');
    header('X-Content-Type-Options: nosniff'); header('Cache-Control: private, no-store, no-cache, must-revalidate, max-age=0');
    readfile($tmp); @unlink($tmp); exit;
}

function bp_download_token_create($claims, $config) {
    $secret = isset($config['key_encryption_secret']) ? trim((string)$config['key_encryption_secret']) : '';
    if (strlen($secret) < 32 || !function_exists('hash_hmac') || !function_exists('random_bytes')) {
        respond(false, array('error'=>'download_signing_unavailable','message'=>'Защищённое скачивание временно недоступно.'), 503);
    }
    $claims['v'] = 1;
    $claims['e'] = time() + 300;
    $claims['n'] = bin2hex(random_bytes(12));
    $json = json_encode($claims, JSON_UNESCAPED_SLASHES);
    if ($json === false) respond(false, array('error'=>'download_link_failed','message'=>'Не удалось подготовить ссылку на скачивание.'), 500);
    $payload = telegram_oidc_base64url_encode($json);
    $signature = telegram_oidc_base64url_encode(hash_hmac('sha256', $payload, $secret, true));
    return $payload . '.' . $signature;
}
function bp_download_token_verify($token, $config) {
    $secret = isset($config['key_encryption_secret']) ? trim((string)$config['key_encryption_secret']) : '';
    if (strlen($secret) < 32 || !is_string($token) || strlen($token) > 2048) return false;
    $parts = explode('.', $token);
    if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') return false;
    $expected = telegram_oidc_base64url_encode(hash_hmac('sha256', $parts[0], $secret, true));
    if (!hash_equals($expected, $parts[1])) return false;
    $json = telegram_oidc_base64url_decode($parts[0]);
    if ($json === false) return false;
    $claims = json_decode($json, true);
    if (!is_array($claims) || (int)($claims['v'] ?? 0) !== 1 || (int)($claims['e'] ?? 0) < time() || (int)($claims['e'] ?? 0) > time() + 300) return false;
    if (!in_array(isset($claims['k']) ? $claims['k'] : '', array('file','all'), true)) return false;
    if ((int)($claims['a'] ?? 0) < 1 || (int)($claims['o'] ?? 0) < 1 || empty($claims['n'])) return false;
    if ($claims['k'] === 'file' && (int)($claims['f'] ?? 0) < 1) return false;
    return $claims;
}
function create_web_download_link($pdo, $auth, $config, $input) {
    require_seller_or_admin($auth);
    if (empty($auth['is_admin'])) require_active_subscription($auth['tg_id']);
    require_web_price_features($pdo);
    $actorId = (int)$auth['tg_id'];
    $ownerId = (!empty($auth['is_admin']) && isset($input['user_id'])) ? (int)$input['user_id'] : $actorId;
    if ($ownerId < 1) respond(false, array('error'=>'invalid_user_id'), 400);
    $kind = isset($input['kind']) ? (string)$input['kind'] : 'file';
    $claims = array('a'=>$actorId, 'o'=>$ownerId, 'k'=>$kind, 'admin'=>!empty($auth['is_admin']) ? 1 : 0);
    $filename = 'basalt-price-lists.zip';
    if ($kind === 'file') {
        $fileId = isset($input['file_id']) ? (int)$input['file_id'] : 0;
        if ($fileId < 1) respond(false, array('error'=>'invalid_file_id'), 400);
        $stmt = $pdo->prepare("SELECT filename FROM price_lists WHERE id=? AND owner_tg_id=? AND status='ready' LIMIT 1");
        $stmt->execute(array($fileId, $ownerId));
        $name = $stmt->fetchColumn();
        if (!$name) respond(false, array('error'=>'file_not_found','message'=>'Файл отсутствует или ещё обрабатывается.'), 404);
        $claims['f'] = $fileId;
        $filename = safe_price_filename($name);
    } elseif ($kind === 'all') {
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM price_lists WHERE owner_tg_id=? AND status='ready'");
        $stmt->execute(array($ownerId));
        if ((int)$stmt->fetchColumn() < 1) respond(false, array('error'=>'no_ready_files','message'=>'Нет готовых прайс-листов для скачивания.'), 404);
    } else {
        respond(false, array('error'=>'invalid_download_kind'), 400);
    }
    $base = isset($config['site_url']) ? rtrim((string)$config['site_url'], '/') : '';
    $parts = parse_url($base);
    if (!$parts || empty($parts['scheme']) || strtolower($parts['scheme']) !== 'https' || empty($parts['host'])) {
        respond(false, array('error'=>'download_site_url_invalid','message'=>'Не настроен HTTPS-адрес сайта для скачивания.'), 503);
    }
    $token = bp_download_token_create($claims, $config);
    return array('url'=>$base . '/api.php?download_token=' . rawurlencode($token), 'filename'=>$filename, 'expires_in'=>300);
}
function serve_signed_web_download($pdo, $config, $token) {
    $claims = bp_download_token_verify($token, $config);
    if (!$claims) {
        http_response_code(403);
        header('Content-Type: text/plain; charset=utf-8');
        header('Cache-Control: no-store');
        echo 'Download link expired or invalid.';
        exit;
    }
    $auth = resolve_user_auth((int)$claims['a']);
    if (!empty($claims['admin']) && empty($auth['is_admin'])) {
        http_response_code(403); exit('Access denied.');
    }
    if (empty($auth['is_admin']) && (int)$claims['a'] !== (int)$claims['o']) {
        http_response_code(403); exit('Access denied.');
    }
    enforce_account_locks($auth, (int)$auth['tg_id'], 'download_file', $pdo);
    if ($claims['k'] === 'file') {
        $input = array('file_id'=>(int)$claims['f']);
        if (!empty($auth['is_admin']) && (int)$claims['o'] !== (int)$auth['tg_id']) $input['user_id'] = (int)$claims['o'];
        download_web_price_list($pdo, $auth, $config, $input);
    }
    $input = array();
    if (!empty($auth['is_admin']) && (int)$claims['o'] !== (int)$auth['tg_id']) $input['user_id'] = (int)$claims['o'];
    download_all_web_price_lists($pdo, $auth, $config, $input);
}

function download_web_price_list($pdo, $auth, $config, $input) {
    require_seller_or_admin($auth);
    if (empty($auth['is_admin'])) require_active_subscription($auth['tg_id']);
    require_web_price_features($pdo);
    $fileId = isset($input['file_id']) ? (int)$input['file_id'] : 0;
    if ($fileId < 1) respond(false,array('error'=>'invalid_file_id'),400);
    $ownerId = (int)$auth['tg_id'];
    if (!empty($auth['is_admin']) && isset($input['user_id'])) $ownerId = (int)$input['user_id'];
    $stmt = $pdo->prepare("SELECT filename,filepath,size_bytes,status FROM price_lists WHERE id=? AND owner_tg_id=? AND status='ready' LIMIT 1");
    $stmt->execute(array($fileId,$ownerId));
    $file = $stmt->fetch();
    if (!$file || empty($file['filepath'])) respond(false,array('error'=>'file_not_found','message'=>'Файл отсутствует или ещё обрабатывается.'),404);
    $storage = configured_web_upload_storage_dir($config);
    $allowedRoots = array();
    $newRoot = realpath($storage); if ($newRoot !== false) $allowedRoots[] = rtrim($newRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
    if (!empty($config['price_list_storage_dir'])) { $legacyRoot = realpath((string)$config['price_list_storage_dir']); if ($legacyRoot !== false) $allowedRoots[] = rtrim($legacyRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR; }
    $path = realpath((string)$file['filepath']);
    $insideAllowedRoot = false;
    if ($path !== false) foreach ($allowedRoots as $allowedRoot) { if (strpos($path, $allowedRoot) === 0) { $insideAllowedRoot = true; break; } }
    if (!$insideAllowedRoot || $path === false || !is_file($path)) {
        respond(false,array('error'=>'file_not_found','message'=>'Файл больше недоступен на сервере.'),404);
    }
    $name = safe_price_filename($file['filename']);
    $mime = 'application/octet-stream';
    if (function_exists('finfo_open')) { $finfo = finfo_open(FILEINFO_MIME_TYPE); if ($finfo) { $detected = finfo_file($finfo, $path); if ($detected) $mime = $detected; finfo_close($finfo); } }
    while (ob_get_level() > 0) @ob_end_clean();
    header_remove('Content-Type');
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . (string)filesize($path));
    header('Content-Disposition: attachment; filename="price-list.' . strtolower(pathinfo($name, PATHINFO_EXTENSION)) . '"; filename*=UTF-8\'\'' . rawurlencode($name));
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-store, no-cache, must-revalidate, max-age=0');
    readfile($path);
    exit;
}
