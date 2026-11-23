<?php
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: private, no-store, max-age=0');
header('X-Content-Type-Options: nosniff');
?>
<!doctype html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#111111">
    <title>Basalt Perfume | Уведомления</title>
    <link rel="stylesheet" href="/assets/app.css?v=66">
    <link rel="stylesheet" href="/assets/css/visual-system.css?v=77">
    <link rel="stylesheet" href="/assets/css/modals.css?v=15">
    <link rel="stylesheet" href="/assets/css/preview.css?v=12">
    <link rel="icon" href="/favicon.ico?v=138" type="image/x-icon">
    <script src="/telegram-web-app.js"></script>
    <script src="/assets/js/core/device-mode.js?v=1"></script>
    <script>/* Guard the shell before paint, but recognize signed init data even if Telegram's JS bridge failed to load. */
    (function () {
        document.documentElement.classList.add('ui-boot-pending');
        var data = '';
        try {
            data = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) || '';
            if (!data) {
                var hash = new URLSearchParams((location.hash || '').replace(/^#/, ''));
                var query = new URLSearchParams(location.search || '');
                data = hash.get('tgWebAppData') || query.get('tgWebAppData') || '';
            }
        } catch (e) {
        }
        if (!data) document.documentElement.classList.add('external-open-pending');
    })();</script>
    <script>window.BASALT_BOT_USERNAME = 'basalt_perfume_bot';</script>
    <link rel="stylesheet" href="/assets/desktop/desktop.css?v=45">
</head>
<body class="desktop-shell" data-initial-screen="notifications">
<div class="boot-blur-overlay is-visible" id="bootBlurOverlay" aria-hidden="true"></div>
<canvas id="orbCanvas" aria-hidden="true"></canvas>
<div class="app-shell">
<aside class="desktop-sidebar" id="desktopSidebar" aria-label="Основная навигация">
  <button type="button" class="desktop-sidebar-brand" id="desktopSidebarToggle" aria-controls="desktopSidebar" aria-expanded="true" aria-label="Свернуть меню" title="Свернуть меню"><img src="/assets/img/logo.svg?v=2" alt="Basalt"><span><strong>BASALT</strong><small>PERFUME CENTER</small></span></button>
    <nav class="desktop-side-nav" aria-label="Основная навигация">
    <button type="button" data-screen="home" data-nav-index="0"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg><span>Главная</span></button>
    <button type="button" data-screen="prices" data-nav-index="1"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8"/></svg><span>Прайсы</span></button>
    <button type="button" data-screen="search" data-nav-index="2"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg><span>Поиск товаров</span></button>
    <button type="button" data-screen="subscription" data-nav-index="3"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18"/><circle cx="15.5" cy="14.5" r="2"/></svg><span>Подписка</span></button>
    <button type="button" data-screen="settings" data-nav-index="4"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></svg><span>Настройки</span></button>
    <button type="button" data-screen="notifications" data-nav-index="5"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span>Уведомления</span><i class="desktop-nav-unread-dot" id="desktopUnreadDot" aria-hidden="true"></i></button>
    <button type="button" data-screen="support" data-nav-index="6"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 4.2 1.8c-1.2 1.1-1.8 1.4-1.8 3M12 17.3h.01"/></svg><span>Поддержка</span></button>
    <button type="button" data-screen="admin" data-nav-index="7" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 4v5c0 5-3.4 7.8-8 9-4.6-1.2-8-4-8-9V7zM9 12l2 2 4-4"/></svg><span>Админ-панель</span></button>
  </nav>
</aside>

    <header class="topbar">
        <div class="brand-mark" aria-label="Basalt"><img class="brand-logo" src="/assets/img/logo.svg?v=1" alt="Basalt">
        </div>
        <div class="brand-copy"><strong>BASALT</strong><small>PERFUME CENTER</small></div>
        <nav class="desktop-compact-nav" id="desktopCompactNav" aria-label="Быстрая навигация">
  <button type="button" data-screen="home" data-nav-index="0">Главная</button>
  <button type="button" data-screen="prices" data-nav-index="1">Прайсы</button>
  <button type="button" data-screen="search" data-nav-index="2">Поиск товаров</button>
  <button type="button" data-screen="subscription" data-nav-index="3">Подписка</button>
  <button type="button" data-screen="settings" data-nav-index="4">Настройки</button>
  <button type="button" data-screen="notifications" data-nav-index="5">Уведомления</button>
  <button type="button" data-screen="support" data-nav-index="6">Поддержка</button>
  <button type="button" data-screen="admin" data-nav-index="7" hidden>Админ-панель</button>
</nav>
        <button class="icon-button mark-all-read-button" id="markAllReadButton" aria-label="Прочитать все уведомления"
                title="Прочитать все уведомления" hidden disabled>
            <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m2.8 12.5 4.1 4.1 7.3-7.8"/>
                <path d="m9.6 12.5 4.1 4.1 7.3-7.8"/>
            </svg>
        </button>
        <button class="icon-button" id="notificationsButton" aria-label="Уведомления">
            <svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>
            </svg>
            <i id="unreadDot"></i></button>
    </header>
<div class="desktop-page-meta" id="desktopPageMeta" aria-live="polite">
  <div class="desktop-breadcrumb"><span>Basalt Perfume</span><span class="desktop-breadcrumb-separator">/</span><strong id="desktopCurrentSection">Главная</strong></div>
  <div class="desktop-page-meta-actions"><span class="desktop-page-context">PERFUME CENTER</span></div>
</div>
    <main id="app" aria-live="polite">
        <section class="loading-card desktop-catalog-loading" role="status" aria-label="Загрузка">
            <div class="dot-matrix-loader" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
            <p>Загружаем ваш каталог…</p>
        </section>
    </main>
    <div class="preview-badge" id="previewBadge" aria-live="polite">ПРЕДПРОСМОТР</div>
    <nav class="bottom-nav" id="bottomNav" hidden>
        <button data-screen="home" data-nav-index="0" class="active"><span class="nav-icon"><svg class="svg-icon" width="21" height="21" width="21" height="21"
                                                                                                 viewBox="0 0 24 24"
                                                                                                 fill="none"
                                                                                                 stroke="currentColor"
                                                                                                 stroke-width="1.7"
                                                                                                 stroke-linecap="round"
                                                                                                 stroke-linejoin="round"
                                                                                                 aria-hidden="true"><path
                d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg></span><small>Главная</small>
        </button>
        <button data-screen="prices" data-nav-index="1" data-nav-primary><span class="nav-icon"><svg class="svg-icon" width="21" height="21" width="21" height="21"
                                                                                                     viewBox="0 0 24 24"
                                                                                                     fill="none"
                                                                                                     stroke="currentColor"
                                                                                                     stroke-width="1.7"
                                                                                                     stroke-linecap="round"
                                                                                                     stroke-linejoin="round"
                                                                                                     aria-hidden="true"><path
                d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path
                d="M14 2v6h6M8 13h8M8 17h8"/></svg></span><small>Прайсы</small></button>
        <button data-screen="subscription" data-nav-index="2"><span class="nav-icon"><svg class="svg-icon" width="21" height="21" width="21" height="21"
                                                                                          viewBox="0 0 24 24"
                                                                                          fill="none"
                                                                                          stroke="currentColor"
                                                                                          stroke-width="1.7"
                                                                                          stroke-linecap="round"
                                                                                          stroke-linejoin="round"
                                                                                          aria-hidden="true"><rect x="3"
                                                                                                                   y="5"
                                                                                                                   width="18"
                                                                                                                   height="14"
                                                                                                                   rx="2.5"/><path
                d="M3 10h18"/><circle cx="15.5" cy="14.5" r="2"/><path d="M17 14.5h2.5m-1.2 0v1.3"/></svg></span><small>Подписка</small>
        </button>
        <button data-screen="settings" data-nav-index="3"><span class="nav-icon"><svg class="svg-icon" width="21" height="21" width="21" height="21"
                                                                                      viewBox="0 0 24 24" fill="none"
                                                                                      stroke="currentColor"
                                                                                      stroke-width="1.7"
                                                                                      stroke-linecap="round"
                                                                                      stroke-linejoin="round"
                                                                                      aria-hidden="true"><circle cx="12"
                                                                                                                 cy="12"
                                                                                                                 r="3"/><path
                d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.08a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.08a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/></svg></span><small>Настройки</small>
        </button>
        <button id="adminNavButton" data-screen="admin" data-nav-index="4" hidden><span class="nav-icon"><svg
                class="svg-icon" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path
                d="M12 3l8 4v5c0 5-3.4 7.8-8 9-4.6-1.2-8-4-8-9V7z"/><path
                d="M9 12l2 2 4-4"/></svg></span><small>Админка</small></button>
    </nav>
</div>
<div id="toast" class="toast" role="status"></div>
<script src="/assets/js/core/api.js?v=2"></script>
<script src="/assets/js/components/icons.js?v=14"></script>
<script src="/assets/js/effects.js?v=4"></script>
<script src="/assets/js/features/preview.js?v=3"></script>
<!-- Basalt WebApp assets are shipped as WebP/JPEG; no PNG assets are required. -->
<script src="/assets/app.js?v=123"></script>
<script>
    (function () {
        // If a script never loads or fails before bootstrapping the UI, replace the static
        // starter spinner with a recovery action instead of leaving it there indefinitely.
        window.setTimeout(function () {
            var app = document.getElementById('app');
            if (!app || !app.querySelector('.loading-card')) return;
            document.documentElement.classList.remove('ui-boot-pending');
            var bootVeil = document.getElementById('bootBlurOverlay'); if (bootVeil) bootVeil.classList.remove('is-visible');
            app.innerHTML = '<section class="empty"><div class="symbol">!</div><strong>Приложение не запустилось</strong><p class="tiny">Скрипты или сервер не ответили. Проверьте соединение и перезагрузите WebApp.</p><button type="button" class="button secondary" id="reloadWebApp">Перезагрузить</button></section>';
            var retry = document.getElementById('reloadWebApp');
            if (retry) retry.addEventListener('click', function () {
                window.location.reload();
            });
        }, 30000);
    })();
</script>
</body>
</html>
