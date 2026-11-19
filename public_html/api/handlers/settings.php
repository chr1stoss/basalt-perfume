<?php
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
if ($action === 'support') respond(true,array('developer_username'=>$config['developer_username'],'faq'=>array(array('q'=>'Как загрузить прайс-лист?','a'=>'Откройте страницу «Прайсы», выберите один или несколько Excel/CSV-файлов и нажмите «Загрузить и обработать». Сервер обработает их и добавит товары в каталог.'),array('q'=>'Почему часть строк требует проверки?','a'=>'Цена или название не распознаны однозначно. Такие значения сохраняются для ручной проверки.'),array('q'=>'Сколько времени обрабатывается один файл?','a'=>'Обычно обработка одного файла занимает примерно 3–5 минут. Время зависит от размера прайс-листа и количества строк.'),array('q'=>'Как обрабатываются конфликтные файлы?','a'=>'При совпадении система предложит выбрать «Отмена» или «Замена». Новая версия заменит старую только после успешной обработки.'),array('q'=>'Когда придёт напоминание о подписке?','a'=>'При включённых уведомлениях: за 72 часа до окончания и далее каждые 24 часа.'),array('q'=>'Какие форматы поддерживаются?','a'=>'.xls, .xlsx, .xlsm, .csv и .tsv.'))),200);
