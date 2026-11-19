<?php
function require_web_price_features($pdo) {
    // Website uploads/downloads are now a permanent site capability; no admin toggle or bot setting gates them.
    return;
}
function safe_price_filename($name) {
    $name = basename(str_replace('\\', '/', (string)$name));
    $name = preg_replace('/[\\x00-\\x1F\\x7F]/u', '', $name);
    $name = trim($name);
    if ($name === '' || $name === '.' || $name === '..') $name = 'price-list.xlsx';
    return function_exists('mb_substr') ? mb_substr($name, 0, 230, 'UTF-8') : substr($name, 0, 230);
}
function configured_web_upload_storage_dir($config) {
    $env = getenv('WEB_UPLOAD_STORAGE_DIR');
    if ($env !== false && trim((string)$env) !== '') return rtrim(trim((string)$env), DIRECTORY_SEPARATOR);
    if (!empty($config['web_upload_storage_dir'])) return rtrim((string)$config['web_upload_storage_dir'], DIRECTORY_SEPARATOR);
    // Safe fallback for legacy installations. For Sweb, explicitly set web_upload_storage_dir
    // in config/database.php to /home/<login>/uploaded_filed.
    return dirname(dirname(BP_PUBLIC_ROOT)) . DIRECTORY_SEPARATOR . 'uploaded_filed';
}
function upload_web_price_list($pdo, $auth, $config) {
    require_seller_or_admin($auth);
    require_active_subscription($auth['tg_id']);
    require_web_price_features($pdo);
    if (!isset($_FILES['price_file']) || !is_array($_FILES['price_file'])) respond(false,array('error'=>'upload_missing','message'=>'Выберите файл прайс-листа.'),400);
    $upload = $_FILES['price_file'];
    if (!isset($upload['error']) || (int)$upload['error'] !== UPLOAD_ERR_OK || empty($upload['tmp_name']) || !is_uploaded_file($upload['tmp_name'])) {
        $error = isset($upload['error']) ? (int)$upload['error'] : UPLOAD_ERR_NO_FILE;
        $message = $error === UPLOAD_ERR_INI_SIZE || $error === UPLOAD_ERR_FORM_SIZE ? 'Файл превышает допустимый размер на сервере.' : 'Не удалось принять файл. Проверьте формат и повторите загрузку.';
        respond(false,array('error'=>'upload_failed','message'=>$message),400);
    }
    $filename = safe_price_filename(isset($upload['name']) ? $upload['name'] : 'price-list.xlsx');
    $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    if (!in_array($extension, array('xls','xlsx','csv'), true)) respond(false,array('error'=>'unsupported_file_type','message'=>'Поддерживаются только Excel (.xls, .xlsx) и CSV-файлы.'),415);
    $size = isset($upload['size']) ? (int)$upload['size'] : (int)filesize($upload['tmp_name']);
    $maxMb = isset($config['max_upload_mb']) ? max(1, min(100, (int)$config['max_upload_mb'])) : 20;
    $configuredMax = (int)app_setting_value($pdo, 'max_file_size_mb', (string)$maxMb);
    if ($configuredMax > 0) $maxMb = min($maxMb, $configuredMax);
    if ($size < 1 || $size > $maxMb * 1024 * 1024) respond(false,array('error'=>'file_too_large','message'=>'Размер файла должен быть не больше '.$maxMb.' МБ.'),413);
    $storage = configured_web_upload_storage_dir($config);
    $storage = rtrim($storage, DIRECTORY_SEPARATOR);
    if (!is_dir($storage) && !@mkdir($storage, 0750, true) && !is_dir($storage)) respond(false,array('error'=>'upload_storage_unavailable','message'=>'Каталог хранения файлов недоступен. Проверьте web_upload_storage_dir в config/database.php и права доступа.'),500);
    $storageReal = realpath($storage);
    if ($storageReal === false || !is_writable($storageReal)) respond(false,array('error'=>'upload_storage_unavailable','message'=>'Каталог хранения файлов недоступен для записи. Проверьте права веб-сервера.'),500);
    $userDir = $storageReal . DIRECTORY_SEPARATOR . (int)$auth['tg_id'];
    if (!is_dir($userDir) && !@mkdir($userDir, 0750, true) && !is_dir($userDir)) respond(false,array('error'=>'upload_storage_unavailable','message'=>'Не удалось подготовить каталог пользователя.'),500);
    $storedName = 'web_' . bin2hex(random_bytes(12)) . '.' . $extension;
    $target = $userDir . DIRECTORY_SEPARATOR . $storedName;
    if (!move_uploaded_file($upload['tmp_name'], $target)) respond(false,array('error'=>'upload_save_failed','message'=>'Не удалось сохранить загруженный файл.'),500);
    @chmod($target, 0640);
    $dbName = $filename;
    $suffix = 1;
    $check = $pdo->prepare('SELECT 1 FROM price_lists WHERE owner_tg_id=? AND filename=? LIMIT 1');
    while (true) {
        $check->execute(array((int)$auth['tg_id'], $dbName));
        if (!$check->fetchColumn()) break;
        $extPart = pathinfo($filename, PATHINFO_EXTENSION);
        $basePart = pathinfo($filename, PATHINFO_FILENAME);
        $dbName = (function_exists('mb_substr') ? mb_substr($basePart, 0, 200, 'UTF-8') : substr($basePart, 0, 200)) . ' (' . (++$suffix) . ')' . ($extPart !== '' ? '.' . $extPart : '');
    }
    try {
        $pdo->beginTransaction();
        $insert = $pdo->prepare("INSERT INTO price_lists(filename,owner_tg_id,filepath,size_bytes,status,supplier_name,imported_at,parser_version) VALUES(?,?,?,?, 'processing',?,NOW(),'2.2.0')");
        $insert->execute(array($dbName,(int)$auth['tg_id'],$target,$size,pathinfo($filename, PATHINFO_FILENAME)));
        $priceListId = (int)$pdo->lastInsertId();
        $job = $pdo->prepare("INSERT INTO web_upload_site_jobs(price_list_id,owner_tg_id,filename,filepath,size_bytes,status,attempts,created_at,updated_at) VALUES(?,?,?,?,?,'pending',0,NOW(),NOW())");
        $job->execute(array($priceListId,(int)$auth['tg_id'],$dbName,$target,$size));
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        @unlink($target);
        throw $e;
    }
    respond(true,array('uploaded'=>true,'file_id'=>$priceListId,'filename'=>$dbName,'status'=>'processing'),202);
}

function web_upload_batch_id($input) {
    $batchId = isset($input['batch_id']) ? strtolower(trim((string)$input['batch_id'])) : '';
    if (!preg_match('/^[a-f0-9]{24,64}$/', $batchId)) respond(false, array('error'=>'upload_batch_invalid','message'=>'Сессия загрузки недействительна. Повторите загрузку.'), 400);
    return $batchId;
}
function web_upload_is_inside($path, $root) {
    $path = rtrim(str_replace('\\', '/', (string)$path), '/');
    $root = rtrim(str_replace('\\', '/', (string)$root), '/');
    return $path === $root || strpos($path, $root . '/') === 0;
}
function web_upload_batch_dir($config, $tgId, $batchId, $create) {
    $storage = configured_web_upload_storage_dir($config);
    if (!is_dir($storage) && $create && !@mkdir($storage, 0750, true) && !is_dir($storage)) respond(false, array('error'=>'upload_storage_unavailable','message'=>'Каталог приватных загрузок недоступен.'), 500);
    $storageReal = realpath($storage);
    if ($storageReal === false || !is_dir($storageReal) || !is_writable($storageReal)) respond(false, array('error'=>'upload_storage_unavailable','message'=>'Каталог приватных загрузок недоступен для записи. Проверьте права веб-сервера.'), 500);
    $userDir = $storageReal . DIRECTORY_SEPARATOR . (int)$tgId;
    if (!is_dir($userDir) && $create && !@mkdir($userDir, 0750, true) && !is_dir($userDir)) respond(false, array('error'=>'upload_storage_unavailable','message'=>'Не удалось подготовить каталог пользователя.'), 500);
    $userReal = realpath($userDir);
    if ($userReal === false || !web_upload_is_inside($userReal, $storageReal) || !is_dir($userReal) || !is_writable($userReal)) respond(false, array('error'=>'upload_storage_unavailable','message'=>'Каталог пользователя недоступен для записи.'), 500);
    $stagingRoot = $userReal . DIRECTORY_SEPARATOR . '.web-upload-staging';
    if (!is_dir($stagingRoot) && $create && !@mkdir($stagingRoot, 0750, true) && !is_dir($stagingRoot)) respond(false, array('error'=>'upload_storage_unavailable','message'=>'Не удалось подготовить временный каталог.'), 500);
    $batchDir = $stagingRoot . DIRECTORY_SEPARATOR . $batchId;
    if (!is_dir($batchDir) && $create && !@mkdir($batchDir, 0750, true) && !is_dir($batchDir)) respond(false, array('error'=>'upload_storage_unavailable','message'=>'Не удалось подготовить временную загрузку.'), 500);
    $batchReal = realpath($batchDir);
    if ($batchReal === false || !is_dir($batchReal) || !web_upload_is_inside($batchReal, $userReal) || !is_writable($batchReal)) {
        if (!$create) return null;
        respond(false, array('error'=>'upload_batch_invalid','message'=>'Временная загрузка недоступна.'), 400);
    }
    return array('storage'=>$storageReal, 'user'=>$userReal, 'staging'=>$stagingRoot, 'batch'=>$batchReal);
}
function web_upload_manifest_lock($batchDir) {
    $handle = @fopen($batchDir . DIRECTORY_SEPARATOR . 'manifest.lock', 'c+');
    if (!$handle || !@flock($handle, LOCK_EX)) {
        if ($handle) @fclose($handle);
        respond(false, array('error'=>'upload_batch_busy','message'=>'Загрузка сейчас обновляется. Повторите действие через несколько секунд.'), 409);
    }
    return $handle;
}
function web_upload_manifest_read($batchDir) {
    $path = $batchDir . DIRECTORY_SEPARATOR . 'manifest.json';
    if (!is_file($path) || !is_readable($path)) return null;
    $raw = @file_get_contents($path);
    $data = $raw !== false ? json_decode($raw, true) : null;
    return is_array($data) ? $data : null;
}
function web_upload_manifest_write($batchDir, $manifest) {
    $json = json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) throw new RuntimeException('Could not encode upload manifest');
    $target = $batchDir . DIRECTORY_SEPARATOR . 'manifest.json';
    $temp = $target . '.' . bin2hex(random_bytes(5)) . '.tmp';
    if (@file_put_contents($temp, $json, LOCK_EX) === false || !@rename($temp, $target)) {
        @unlink($temp);
        throw new RuntimeException('Could not persist upload manifest');
    }
    @chmod($target, 0640);
}
function web_upload_remove_tree($path, $root) {
    $rootReal = realpath($root);
    if (is_link($path)) {
        $parentReal = realpath(dirname($path));
        if ($parentReal !== false && $rootReal !== false && web_upload_is_inside($parentReal, $rootReal)) @unlink($path);
        return;
    }
    $real = realpath($path);
    if ($real === false || $rootReal === false || !web_upload_is_inside($real, $rootReal) || $real === $rootReal) return;
    if (is_dir($real) && !is_link($real)) {
        $items = @scandir($real);
        if (is_array($items)) foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            web_upload_remove_tree($real . DIRECTORY_SEPARATOR . $item, $rootReal);
        }
        @rmdir($real);
    } else {
        @unlink($real);
    }
}
function stage_web_price_list($pdo, $auth, $config, $input) {
    require_seller_or_admin($auth);
    require_active_subscription($auth['tg_id']);
    require_web_price_features($pdo);
    if (!isset($_FILES['price_file']) || !is_array($_FILES['price_file'])) respond(false, array('error'=>'upload_missing','message'=>'Выберите файл прайс-листа.'), 400);
    $upload = $_FILES['price_file'];
    if (!isset($upload['error']) || (int)$upload['error'] !== UPLOAD_ERR_OK || empty($upload['tmp_name']) || !is_uploaded_file($upload['tmp_name'])) {
        respond(false, array('error'=>'upload_failed','message'=>'Не удалось принять файл. Проверьте формат и повторите загрузку.'), 400);
    }
    $filename = safe_price_filename(isset($upload['name']) ? $upload['name'] : 'price-list.xlsx');
    $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    if (!in_array($extension, array('xls','xlsx','csv'), true)) respond(false, array('error'=>'unsupported_file_type','message'=>'Поддерживаются только Excel (.xls, .xlsx) и CSV-файлы.'), 415);
    $size = isset($upload['size']) ? (int)$upload['size'] : (int)filesize($upload['tmp_name']);
    $maxMb = isset($config['max_upload_mb']) ? max(1, min(100, (int)$config['max_upload_mb'])) : 20;
    $configuredMax = (int)app_setting_value($pdo, 'max_file_size_mb', (string)$maxMb);
    if ($configuredMax > 0) $maxMb = min($maxMb, $configuredMax);
    if ($size < 1 || $size > $maxMb * 1024 * 1024) respond(false, array('error'=>'file_too_large','message'=>'Размер файла должен быть не больше '.$maxMb.' МБ.'), 413);
    $batchId = web_upload_batch_id($input);
    $paths = web_upload_batch_dir($config, $auth['tg_id'], $batchId, true);
    $token = bin2hex(random_bytes(12));
    $stagedName = 'stage_' . $token . '.' . $extension;
    $stagedPath = $paths['batch'] . DIRECTORY_SEPARATOR . $stagedName;
    if (!move_uploaded_file($upload['tmp_name'], $stagedPath)) respond(false, array('error'=>'upload_save_failed','message'=>'Не удалось сохранить временный файл.'), 500);
    @chmod($stagedPath, 0640);
    $lock = web_upload_manifest_lock($paths['batch']);
    try {
        $manifest = web_upload_manifest_read($paths['batch']);
        if (!$manifest) $manifest = array('version'=>1,'batch_id'=>$batchId,'owner_tg_id'=>(int)$auth['tg_id'],'status'=>'uploading','created_at'=>time(),'files'=>array());
        if ((int)($manifest['owner_tg_id'] ?? 0) !== (int)$auth['tg_id'] || !in_array((string)($manifest['status'] ?? ''), array('uploading'), true)) {
            @unlink($stagedPath);
            respond(false, array('error'=>'upload_batch_closed','message'=>'Эта группа загрузки уже закрыта. Начните новую загрузку.'), 409);
        }
        $manifest['files'][] = array('token'=>$token,'filename'=>$filename,'size_bytes'=>$size,'path'=>$stagedPath);
        web_upload_manifest_write($paths['batch'], $manifest);
    } catch (Throwable $e) {
        @unlink($stagedPath);
        throw $e;
    } finally {
        @flock($lock, LOCK_UN);
        @fclose($lock);
    }
    respond(true, array('uploaded'=>true,'staged'=>true,'file_token'=>$token,'filename'=>$filename,'size_bytes'=>$size), 202);
}
function request_web_upload_scan($config, $auth, $input) {
    require_seller_or_admin($auth);
    $batchId = web_upload_batch_id($input);
    $paths = web_upload_batch_dir($config, $auth['tg_id'], $batchId, false);
    if (!$paths) respond(false, array('error'=>'upload_batch_expired','message'=>'Временная загрузка не найдена. Загрузите файлы повторно.'), 404);
    $lock = web_upload_manifest_lock($paths['batch']);
    try {
        $manifest = web_upload_manifest_read($paths['batch']);
        if (!$manifest || (int)($manifest['owner_tg_id'] ?? 0) !== (int)$auth['tg_id']) respond(false, array('error'=>'upload_batch_expired','message'=>'Временная загрузка не найдена.'), 404);
        if (empty($manifest['files'])) respond(false, array('error'=>'upload_batch_empty','message'=>'Нет файлов для проверки.'), 400);
        if (!in_array((string)($manifest['status'] ?? ''), array('uploading','scan_error'), true)) {
            respond(true, array('status'=>(string)$manifest['status']), 200);
        }
        $manifest['status'] = 'scan_pending';
        $manifest['scan_progress'] = 0.0;
        $manifest['scan_error'] = null;
        $manifest['review'] = null;
        web_upload_manifest_write($paths['batch'], $manifest);
    } finally {
        @flock($lock, LOCK_UN);
        @fclose($lock);
    }
    respond(true, array('status'=>'scan_pending'), 202);
}
function web_upload_review_status($config, $auth, $input) {
    require_seller_or_admin($auth);
    $batchId = web_upload_batch_id($input);
    $paths = web_upload_batch_dir($config, $auth['tg_id'], $batchId, false);
    if (!$paths) respond(false, array('error'=>'upload_batch_expired','message'=>'Временная загрузка не найдена.'), 404);
    $manifest = web_upload_manifest_read($paths['batch']);
    if (!$manifest || (int)($manifest['owner_tg_id'] ?? 0) !== (int)$auth['tg_id']) respond(false, array('error'=>'upload_batch_expired','message'=>'Временная загрузка не найдена.'), 404);
    $files = array();
    foreach ((array)($manifest['review'] ?? array()) as $item) {
        $files[] = array(
            'token'=>(string)($item['token'] ?? ''), 'filename'=>(string)($item['filename'] ?? ''),
            'size_bytes'=>(int)($item['size_bytes'] ?? 0), 'row_count'=>isset($item['row_count']) ? (int)$item['row_count'] : null,
            'conflict'=>!empty($item['conflict']), 'match_reasons'=>array_values((array)($item['match_reasons'] ?? array())),
            'existing_names'=>array_slice(array_values((array)($item['existing_names'] ?? array())), 0, 8)
        );
    }
    $scanError = empty($manifest['scan_error']) ? '' : 'Не удалось проверить файлы. Повторите проверку или отмените загрузку.';
    respond(true, array('status'=>(string)($manifest['status'] ?? 'uploading'),'scan_progress'=>max(0,min(100,(float)($manifest['scan_progress'] ?? 0))),'files'=>$files,'error'=>$scanError), 200);
}
function cancel_web_upload_batch($config, $auth, $input) {
    require_seller_or_admin($auth);
    $batchId = web_upload_batch_id($input);
    $paths = web_upload_batch_dir($config, $auth['tg_id'], $batchId, false);
    if ($paths) web_upload_remove_tree($paths['batch'], $paths['user']);
    respond(true, array('cancelled'=>true), 200);
}
function finalize_web_upload_batch($pdo, $config, $auth, $input) {
    require_seller_or_admin($auth);
    require_active_subscription($auth['tg_id']);
    require_web_price_features($pdo);
    $batchId = web_upload_batch_id($input);
    $paths = web_upload_batch_dir($config, $auth['tg_id'], $batchId, false);
    if (!$paths) respond(false, array('error'=>'upload_batch_expired','message'=>'Временная загрузка не найдена.'), 404);
    $lock = web_upload_manifest_lock($paths['batch']);
    $moved = array();
    $queued = array();
    $cancelPaths = array();
    $cancelled = 0;
    $committed = false;
    try {
        $manifest = web_upload_manifest_read($paths['batch']);
        if (!$manifest || (int)($manifest['owner_tg_id'] ?? 0) !== (int)$auth['tg_id'] || ($manifest['status'] ?? '') !== 'review_ready') {
            respond(false, array('error'=>'upload_review_not_ready','message'=>'Проверка файлов ещё не завершена. Повторите попытку.'), 409);
        }
        $reviewByToken = array();
        foreach ((array)($manifest['review'] ?? array()) as $review) $reviewByToken[(string)($review['token'] ?? '')] = $review;
        $choices = isset($input['choices']) && is_array($input['choices']) ? $input['choices'] : array();
        $toProcess = array();
        $claimedOldIds = array();
        $claimedOldPaths = array();
        foreach ((array)$manifest['files'] as $item) {
            $token = (string)($item['token'] ?? '');
            $review = $reviewByToken[$token] ?? null;
            if (!$review) throw new RuntimeException('Upload review item is missing');
            $choice = !empty($review['conflict']) ? (string)($choices[$token] ?? 'cancel') : 'process';
            if (!empty($review['conflict']) && $choice !== 'replace') {
                $cancelled++;
                $cancelPath = realpath((string)($item['path'] ?? ''));
                if ($cancelPath && web_upload_is_inside($cancelPath, $paths['batch']) && is_file($cancelPath)) $cancelPaths[] = $cancelPath;
                continue;
            }
            $source = realpath((string)($item['path'] ?? ''));
            if (!$source || !is_file($source) || !web_upload_is_inside($source, $paths['batch'])) throw new RuntimeException('Staged upload file is missing or unsafe');
            $filename = safe_price_filename($item['filename'] ?? 'price-list.xlsx');
            $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
            if (!in_array($extension, array('xls','xlsx','csv'), true)) throw new RuntimeException('Unsupported staged file extension');
            $target = $paths['user'] . DIRECTORY_SEPARATOR . 'web_' . bin2hex(random_bytes(12)) . '.' . $extension;
            if (!@rename($source, $target)) throw new RuntimeException('Could not move staged file into the private upload directory');
            @chmod($target, 0640);
            $moved[] = array('source'=>$source,'target'=>$target,'sidecar'=>null);
            $replace = !empty($review['conflict']) && $choice === 'replace';
            if ($replace) {
                $review['existing_ids'] = array_values(array_diff(array_map('intval', (array)($review['existing_ids'] ?? array())), $claimedOldIds));
                $review['existing_paths'] = array_values(array_diff(array_map('strval', (array)($review['existing_paths'] ?? array())), $claimedOldPaths));
                if (!$review['existing_ids'] && !$review['existing_paths']) $replace = false;
                else {
                    $claimedOldIds = array_merge($claimedOldIds, $review['existing_ids']);
                    $claimedOldPaths = array_merge($claimedOldPaths, $review['existing_paths']);
                }
            }
            $toProcess[] = array('token'=>$token,'filename'=>$filename,'target'=>$target,'size'=>(int)($item['size_bytes'] ?? filesize($target)),'review'=>$review,'replace'=>$replace,'move_index'=>count($moved)-1);
        }
        if ($toProcess) {
            try {
                $pdo->beginTransaction();
                foreach ($toProcess as $item) {
                    $dbName = $item['filename'];
                    $suffix = 1;
                    $check = $pdo->prepare('SELECT 1 FROM price_lists WHERE owner_tg_id=? AND filename=? LIMIT 1');
                    while (true) {
                        $check->execute(array((int)$auth['tg_id'], $dbName));
                        if (!$check->fetchColumn()) break;
                        $extPart = pathinfo($item['filename'], PATHINFO_EXTENSION);
                        $basePart = pathinfo($item['filename'], PATHINFO_FILENAME);
                        $dbName = (function_exists('mb_substr') ? mb_substr($basePart, 0, 190, 'UTF-8') : substr($basePart, 0, 190)) . ' (' . (++$suffix) . ')' . ($extPart !== '' ? '.' . $extPart : '');
                    }
                    $insert = $pdo->prepare("INSERT INTO price_lists(filename,owner_tg_id,filepath,size_bytes,status,supplier_name,imported_at,parser_version) VALUES(?,?,?,?, 'processing',?,NOW(),'2.2.0')");
                    $insert->execute(array($dbName,(int)$auth['tg_id'],$item['target'],$item['size'],pathinfo($item['filename'], PATHINFO_FILENAME)));
                    $priceListId = (int)$pdo->lastInsertId();
                    $job = $pdo->prepare("INSERT INTO web_upload_site_jobs(price_list_id,owner_tg_id,filename,filepath,size_bytes,status,attempts,created_at,updated_at) VALUES(?,?,?,?,?,'pending',0,NOW(),NOW())");
                    $job->execute(array($priceListId,(int)$auth['tg_id'],$item['filename'],$item['target'],$item['size']));
                    if ($item['replace']) {
                        $sidecar = $item['target'] . '.replace.json';
                        $metadata = array(
                            'owner_tg_id'=>(int)$auth['tg_id'], 'price_list_id'=>$priceListId,
                            'final_filename'=>$item['filename'],
                            'existing_ids'=>array_values(array_map('intval', (array)($item['review']['existing_ids'] ?? array()))),
                            'existing_paths'=>array_values(array_map('strval', (array)($item['review']['existing_paths'] ?? array())))
                        );
                        $json = json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                        if ($json === false || @file_put_contents($sidecar, $json, LOCK_EX) === false) throw new RuntimeException('Could not save replacement metadata');
                        @chmod($sidecar, 0640);
                        $moved[(int)$item['move_index']]['sidecar'] = $sidecar;
                    }
                    $queued[] = array('file_id'=>$priceListId,'filename'=>$item['filename']);
                }
                $pdo->commit();
                $committed = true;
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $e;
            }
        }
        if (!$committed) $committed = true;
        foreach ($cancelPaths as $cancelPath) if (is_file($cancelPath) && web_upload_is_inside($cancelPath, $paths['batch'])) @unlink($cancelPath);
        $manifest['status'] = 'finalized';
        try { web_upload_manifest_write($paths['batch'], $manifest); }
        catch (Throwable $manifestError) { error_log('Could not mark finalized upload batch '.$batchId.': '.$manifestError->getMessage()); }
    } catch (Throwable $e) {
        if (!$committed) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            foreach ($moved as $move) {
                if (!empty($move['sidecar'])) @unlink($move['sidecar']);
                if (is_file($move['target'])) @rename($move['target'], $move['source']);
            }
        }
        throw $e;
    } finally {
        @flock($lock, LOCK_UN);
        @fclose($lock);
    }
    web_upload_remove_tree($paths['batch'], $paths['user']);
    respond(true, array('queued'=>$queued,'cancelled'=>$cancelled,'queued_count'=>count($queued)), count($queued) ? 202 : 200);
}
