<?php
// Safe template. Copy to database.php and fill environment variables on your own server.
// Do not commit or share database.php: it contains private credentials.
return array(
    'db_host' => getenv('MYSQL_HOST') ? getenv('MYSQL_HOST') : '127.0.0.1',
    'db_port' => getenv('MYSQL_PORT') ? (int) getenv('MYSQL_PORT') : 3306,
    'db_name' => getenv('MYSQL_DATABASE') ? getenv('MYSQL_DATABASE') : 'YOUR_DATABASE_NAME',
    'db_user' => getenv('MYSQL_USER') ? getenv('MYSQL_USER') : 'YOUR_DATABASE_USER',
    'db_pass' => getenv('MYSQL_PASSWORD') ? getenv('MYSQL_PASSWORD') : 'YOUR_DATABASE_PASSWORD',
    'key_encryption_secret' => getenv('KEY_ENCRYPTION_SECRET') ? getenv('KEY_ENCRYPTION_SECRET') : '',
    'bot_token' => getenv('BOT_TOKEN') ? getenv('BOT_TOKEN') : 'PASTE_TELEGRAM_BOT_TOKEN',
    'admin_ids' => getenv('ADMIN_IDS') ? getenv('ADMIN_IDS') : 'PASTE_TELEGRAM_ADMIN_ID',
    'developer_username' => getenv('DEVELOPER_USERNAME') ? getenv('DEVELOPER_USERNAME') : '@YOUR_TELEGRAM_USERNAME',
    'bot_username' => getenv('BOT_USERNAME') ? getenv('BOT_USERNAME') : '@YOUR_BOT_USERNAME',
    'site_url' => getenv('SITE_URL') ? getenv('SITE_URL') : 'https://your-domain.example',
    'webapp_url' => getenv('WEBAPP_URL') ? getenv('WEBAPP_URL') : (getenv('SITE_URL') ? getenv('SITE_URL') : 'https://your-domain.example'),
    'app_name' => 'Basalt Perfume',
    'max_upload_mb' => 20
);
