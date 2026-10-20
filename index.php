<?php
$publicBotUsername = 'basalt_perfume_bot';
$configPath = __DIR__ . '/config/database.php';
if (is_file($configPath)) {
    $publicConfig = require $configPath;
    if (is_array($publicConfig) && !empty($publicConfig['bot_username'])) {
        $publicBotUsername = ltrim(trim((string) $publicConfig['bot_username']), '@');
    }
}
?>
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#111111">
<title>Basalt Perfume</title>
<link rel="stylesheet" href="assets/app.css?v=49">
<link rel="stylesheet" href="assets/css/visual-system.css?v=47">
<link rel="stylesheet" href="assets/css/modals.css?v=12">
<link rel="stylesheet" href="assets/css/preview.css?v=11">
<link rel="icon" href="assets/img/icon.ico" type="image/x-icon">
<script src="telegram-web-app.js"></script>
<script>/* Guard the shell before paint, but recognize signed init data even if Telegram's JS bridge failed to load. */(function(){var data='';try{data=(window.Telegram&&window.Telegram.WebApp&&window.Telegram.WebApp.initData)||'';if(!data){var hash=new URLSearchParams((location.hash||'').replace(/^#/,''));var query=new URLSearchParams(location.search||'');data=hash.get('tgWebAppData')||query.get('tgWebAppData')||'';}}catch(e){}if(!data)document.documentElement.classList.add('external-open-pending');})();</script>
<script>window.BASALT_BOT_USERNAME = <?php echo json_encode($publicBotUsername, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT); ?>;</script>
</head>
<body>
<canvas id="orbCanvas" aria-hidden="true"></canvas>
<div class="app-shell">
  <?php require __DIR__ . '/components/header.php'; ?>
  <main id="app" aria-live="polite">
    <section class="loading-card"><div class="dot-matrix-loader" role="status" aria-label="Загрузка"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><p>Подключаем ваш каталог…</p></section>
  </main>
  <div class="preview-badge" id="previewBadge" aria-live="polite">ПРЕДПРОСМОТР</div>
  <?php require __DIR__ . '/components/navbar.php'; ?>
</div>
<div id="toast" class="toast" role="status"></div>
<script src="assets/js/core/api.js?v=8"></script>
<script src="assets/js/components/icons.js?v=13"></script>
<script src="assets/js/effects.js?v=4"></script>
<script src="assets/js/features/preview.js?v=3"></script>
<!-- Basalt WebApp assets are shipped as WebP/JPEG; no PNG assets are required. -->
<script src="assets/app.js?v=69"></script>
<script>
(function () {
  // If a script never loads or fails before bootstrapping the UI, replace the static
  // starter spinner with a recovery action instead of leaving it there indefinitely.
  window.setTimeout(function () {
    var app = document.getElementById('app');
    if (!app || !app.querySelector('.loading-card')) return;
    app.innerHTML = '<section class="empty"><div class="symbol">!</div><strong>Приложение не запустилось</strong><p class="tiny">Скрипты или сервер не ответили. Проверьте соединение и перезагрузите WebApp.</p><button type="button" class="button secondary" id="reloadWebApp">Перезагрузить</button></section>';
    var retry = document.getElementById('reloadWebApp');
    if (retry) retry.addEventListener('click', function () { window.location.reload(); });
  }, 30000);
})();
</script>
</body>
</html>
