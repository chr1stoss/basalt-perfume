<?php
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
        $containsInternalDetails = (bool)preg_match('/(?:traceback|exception|sqlstate|\bSELECT\b|\bINSERT\b|\bUPDATE\b|unknown column|integrityerror|operationalerror|parseerror|stack trace|\.(?:py|php):\d+|(?:^|\s)\/(?:home|var|tmp|srv|opt)\/|[A-Z]:\\|permission denied|no such file or directory|connection refused|access denied for user)/iu',$body);
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
