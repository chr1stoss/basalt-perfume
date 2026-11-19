<?php
if ($action === 'create_download_link') {
    respond(true, create_web_download_link($pdo, $auth, $config, $input), 200);
}
