(function () {
  'use strict';

  // Keep browser/WebView zoom fixed as requested; ordinary one-finger scrolling remains enabled.
  (function disablePageZoom() {
    function preventZoom(event) {
      if (event && event.cancelable) event.preventDefault();
    }
    document.addEventListener('keydown', function (event) {
      if (!event.ctrlKey && !event.metaKey) return;
      var key = String(event.key || '').toLowerCase();
      if (key === '+' || key === '=' || key === '-' || key === '_' || key === '0') preventZoom(event);
    }, {passive: false});
    document.addEventListener('wheel', function (event) {
      if (event.ctrlKey || event.metaKey) preventZoom(event);
    }, {passive: false});
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (name) {
      document.addEventListener(name, preventZoom, {passive: false});
    });
    document.addEventListener('touchmove', function (event) {
      if (event.touches && event.touches.length > 1) preventZoom(event);
    }, {passive: false});
  })();
  var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  function readLaunchInitData() {
    if (tg && tg.initData) return tg.initData;
    // Telegram normally provides this through telegram-web-app.js. If a WebView/network
    // rule blocks that script, the launch URL can still contain the same signed payload.
    try {
      var hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
      var searchParams = new URLSearchParams(window.location.search || '');
      return hashParams.get('tgWebAppData') || searchParams.get('tgWebAppData') || '';
    } catch (e) { return ''; }
  }
  var initData = readLaunchInitData();
  var launchParams = new URLSearchParams(window.location.search || '');
  var previewMode = launchParams.get('preview') === '1';
  var previewModeActive = false;
  var previewRole = null;
  var previewScenario = 'normal';
  var subscriptionGateState = null;
  var initDataUser = null;
  try { var encodedUser = new URLSearchParams(initData).get('user'); if (encodedUser) initDataUser = JSON.parse(encodedUser); } catch (e) {}
  var app = document.getElementById('app');
  if (app) {
    app.addEventListener('click', function (event) {
      if (!app.classList.contains('virtual-preview-page')) return;
      if (event.target && event.target.closest && event.target.closest('[data-preview-return]')) return;
      // This is a read-only demonstration. Block clicks, link navigation and delegated
      // actions, but leave wheel/touch scrolling untouched. The role picker and bottom nav
      // are outside this class and remain usable.
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }, true);
  }
  var activeScreen = 'home';
  var cache = {};
  var settings = {language:'ru',theme:'mono',appearance:'dark',notify_updates:1,notify_processed_files:1,notify_subscription:1,seller_products_public:0,seller_dm_enabled:0};
  function appearanceStorageKey(){var id=initDataUser&&initDataUser.id?String(initDataUser.id):'';return id?'basalt-appearance-v1-'+id:'';}
  try { var savedAppearanceKey=appearanceStorageKey(); if(savedAppearanceKey){var savedAppearance=JSON.parse(localStorage.getItem(savedAppearanceKey)||'null');if(savedAppearance&&typeof savedAppearance==='object'){if(['mono','ocean','forest','rose','amber'].indexOf(savedAppearance.theme)!==-1)settings.theme=savedAppearance.theme;if(['dark','light'].indexOf(savedAppearance.appearance)!==-1)settings.appearance=savedAppearance.appearance;if(['ru','en','kz'].indexOf(savedAppearance.language)!==-1)settings.language=savedAppearance.language;}} } catch (appearanceReadError) {}
  var savedSettings = Object.assign({}, settings);
  var settingsDraftActive = false;
  var expandedNotificationId = null;
  var profile = null;
  var botUsername = String(window.BASALT_BOT_USERNAME || 'YOUR_BOT_USERNAME');
  var isAdmin = false;
  var currentRole = 'seller';
  var currentPriceMultiplier = 1.0;
  var overview = null;
  var useBootOverviewOnce = false;
  var searchTimer = null;
  // Once a screen cannot load, keep every section in the same app-wide failure state.
  var globalLoadFailure = null;
  if (tg) { tg.ready(); tg.expand(); try { tg.setHeaderColor('#0c0c0d'); tg.setBackgroundColor('#0c0c0d'); } catch (e) {} }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function iconSvg(name) { return window.BasaltIcons.svg(name); }
  function excelIconSvg() { return '<svg class="excel-logo" viewBox="0 0 48 48" role="img" aria-label="Microsoft Excel" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M24 5.5h13l6 6V40a3 3 0 0 1-3 3H24"/><path d="M37 5.5v6h6"/><path d="M27 16.5h11M27 23h11M27 29.5h11M27 36h11"/><rect x="2.5" y="12" width="19.5" height="25" rx="3"/><path d="m7.5 19 9 12m0-12-9 12"/></svg>'; }
  function api(action, extra) {
    var writeActions = ['set_price_multiplier','delete_file','save_settings','admin_update_user','admin_extend_user_subscription','admin_delete_user','generate_keys','create_announcement','mark_read','reveal_subscription_key'];
    if (previewModeActive && writeActions.indexOf(String(action)) !== -1) {
      var locked = new Error('preview_readonly'); locked.code = 'preview_readonly'; return Promise.reject(locked);
    }
    return window.BasaltApi.request(action, extra, initData).then(function(result){
      if(previewModeActive && action==='overview' && result){
        result.role=previewRole;result.is_admin=previewRole==='admin';
        if(result.profile)result.profile.role=previewRole;
      }
      return result;
    }).catch(function(error){
      if(error && error.code==='database_timeout' && app){
        globalLoadFailure=error;
        renderGlobalLoadError(error);
      }
      throw error;
    });
  }
  function friendlyError(error) {
    var code = error && error.code ? String(error.code) : '';
    var raw = error && error.message ? String(error.message) : String(error == null ? '' : error);
    if (!code) {
      var codes = ['title_and_message_required','admin_required','invalid_telegram_init_data','subscription_required','file_not_found','unknown_action','database_error','server_error','fatal_error','json_encode_failed'];
      for (var i = 0; i < codes.length; i++) { if (raw.indexOf(codes[i]) >= 0) { code = codes[i]; break; } }
    }
    var lang = settings.language || 'ru';
    var messages = {
      title_and_message_required: {ru:'Заполните оба поля: заголовок и текст сообщения.',en:'Please fill in both fields: the update title and message.',kz:'Екі өрісті де толтырыңыз: жаңарту тақырыбы мен хабарлама мәтіні.'},
      admin_required: {ru:'Это действие доступно только администратору.',en:'This action is available to administrators only.',kz:'Бұл әрекет тек әкімшіге қолжетімді.'},
      invalid_telegram_init_data: {ru:'Не удалось подтвердить вход через Telegram. Закройте приложение и откройте его заново из чата с ботом.',en:'Telegram could not verify your sign-in. Close the app and reopen it from the bot chat.',kz:'Telegram арқылы кіруді растау мүмкін болмады. Қосымшаны жауып, бот чатынан қайта ашыңыз.'},
      subscription_required: {ru:'Для этого действия нужна активная подписка. Откройте чат с ботом и активируйте ключ.',en:'An active subscription is required. Open the bot chat and activate a key.',kz:'Бұл әрекет үшін белсенді жазылым қажет. Бот чатында кілтті белсендіріңіз.'},
      file_not_found: {ru:'Этот прайс-лист уже удалён или недоступен. Обновите список файлов.',en:'This price list was removed or is no longer available. Refresh your files.',kz:'Бұл прайс-парақ жойылған немесе қолжетімсіз. Файлдар тізімін жаңартыңыз.'},
      unknown_action: {ru:'Не удалось выполнить это действие. Обновите приложение и попробуйте ещё раз.',en:'This action could not be completed. Refresh the app and try again.',kz:'Бұл әрекетті орындау мүмкін болмады. Қосымшаны жаңартып, қайта көріңіз.'},
      database_error: {ru:'Не удалось подключиться к базе данных. Проверьте соединение или повторите попытку позже.',en:'Could not connect to the database. Check the connection or retry later.',kz:'Дерекқорға қосылу мүмкін болмады. Қосылымды тексеріңіз немесе кейінірек қайталаңыз.'},
      database_timeout: {ru:'Истекло время ожидания ответа базы данных. Просто перезагрузите страницу и попробуйте ещё раз.',en:'The database response timed out. Reload the page and try again.',kz:'Дерекқор жауабын күту уақыты аяқталды. Бетті қайта жүктеп, қайталап көріңіз.'},
      server_error: {ru:'На сервере возникла проблема. Попробуйте ещё раз позже.',en:'Something went wrong on the server. Please try again later.',kz:'Серверде ақау пайда болды. Кейінірек қайталап көріңіз.'},
      fatal_error: {ru:'Сервис временно не смог выполнить запрос. Попробуйте ещё раз позже.',en:'The service could not complete the request. Please try again later.',kz:'Қызмет сұрауды орындай алмады. Кейінірек қайталап көріңіз.'},
      json_encode_failed: {ru:'Не удалось подготовить ответ сервера. Попробуйте ещё раз позже.',en:'The server could not prepare a response. Please try again later.',kz:'Сервер жауапты дайындай алмады. Кейінірек қайталап көріңіз.'},
      api_network_error: {ru:'Не удалось связаться с сервером. Проверьте подключение к интернету и попробуйте ещё раз.',en:'Could not reach the server. Check your internet connection and try again.',kz:'Серверге қосылу мүмкін болмады. Интернетті тексеріп, қайта көріңіз.'},
      api_timeout: {ru:'Сервер не ответил за 25 секунд. Проверьте соединение, затем нажмите «Повторить».',en:'The server did not respond within 25 seconds. Check your connection and retry.',kz:'Сервер 25 секунд ішінде жауап бермеді. Қосылымды тексеріп, қайта көріңіз.'},
      api_non_json: {ru:'Сервер вернул неожиданный ответ. Попробуйте ещё раз; если ошибка повторится, сообщите администратору.',en:'The server returned an unexpected response. Try again; if it persists, contact the administrator.',kz:'Сервер күтпеген жауап қайтарды. Қайта көріңіз; қате қайталанса, әкімшіге хабарласыңыз.'},
      api_empty_response: {ru:'Сервер не ответил. Попробуйте ещё раз через несколько секунд.',en:'The server did not respond. Please try again in a few seconds.',kz:'Сервер жауап бермеді. Бірнеше секундтан кейін қайта көріңіз.'},
      api_invalid_response: {ru:'Не удалось прочитать ответ сервера. Попробуйте ещё раз.',en:'The server response could not be read. Please try again.',kz:'Сервер жауабын оқу мүмкін болмады. Қайта көріңіз.'},
      api_request_failed: {ru:'Не удалось выполнить действие. Проверьте данные и попробуйте ещё раз.',en:'The action could not be completed. Check the details and try again.',kz:'Әрекетті орындау мүмкін болмады. Мәліметтерді тексеріп, қайта көріңіз.'}
    };
    messages.key_legacy_unrecoverable = {ru:'Полный код этого старого ключа не сохранялся, поэтому восстановить его нельзя. Создайте новый ключ.',en:'The full value of this older key was never stored, so it cannot be recovered. Create a new key.',kz:'Бұл ескі кілттің толық мәні сақталмаған, сондықтан оны қалпына келтіру мүмкін емес. Жаңа кілт жасаңыз.'};
    messages.key_decryption_failed = {ru:'Не удалось расшифровать ключ. Проверьте, что секрет шифрования и реквизиты сервера не менялись.',en:'The key could not be decrypted. Check that the encryption secret and server credentials have not changed.',kz:'Кілтті ашу мүмкін болмады. Шифрлау құпиясөзі мен сервер деректері өзгермегенін тексеріңіз.'};
    messages.key_not_found = {ru:'Этот ключ уже отсутствует в базе.',en:'This key is no longer in the database.',kz:'Бұл кілт дерекқорда жоқ.'};
    messages.invalid_key_id = {ru:'Не удалось определить ключ.',en:'Could not identify the key.',kz:'Кілтті анықтау мүмкін болмады.'};
    if (messages[code]) return messages[code][lang] || messages[code].ru;
    if (/не удалось связаться с api|api вернул|api could not|fetch failed|failed to fetch/i.test(raw) || code === 'api_network_error') {
      return ({ru:'Не удалось связаться с сервером. Проверьте подключение к интернету и попробуйте ещё раз.',en:'Could not reach the server. Check your internet connection and try again.',kz:'Серверге қосылу мүмкін болмады. Интернетті тексеріп, қайта көріңіз.'})[lang] || 'Не удалось связаться с сервером. Проверьте подключение к интернету и попробуйте ещё раз.';
    }
    if (error && error.code) {
      var genericByStatus = Number(error.httpStatus) >= 500
        ? {ru:'На сервере возникла проблема. Попробуйте ещё раз позже.',en:'Something went wrong on the server. Please try again later.',kz:'Серверде ақау пайда болды. Кейінірек қайталап көріңіз.'}
        : {ru:'Не удалось выполнить действие. Проверьте введённые данные и попробуйте ещё раз.',en:'The action could not be completed. Check the details and try again.',kz:'Әрекетті орындау мүмкін болмады. Мәліметтерді тексеріп, қайта көріңіз.'};
      return genericByStatus[lang] || genericByStatus.ru;
    }
    raw = raw.replace(/\s*\(HTTP\s+\d+\)\s*$/i, '').trim();
    if (!raw || raw === '[object Object]' || /^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(raw)) return ({ru:'Что-то пошло не так. Попробуйте ещё раз.',en:'Something went wrong. Please try again.',kz:'Бірдеңе дұрыс болмады. Қайта көріңіз.'})[lang] || 'Что-то пошло не так. Попробуйте ещё раз.';
    return translateHtml(raw);
  }
  function previewReturnButtonMarkup(position){return '<div class="preview-return-row '+(position==='bottom'?'is-bottom':'')+'"><button type="button" class="preview-return-button" data-preview-return>'+iconSvg('chevron')+'<span>К выбору ролей</span></button></div>';}
  function bindPreviewReturnButton(){var button=app.querySelector('[data-preview-return]');if(!button)return;button.onclick=function(event){event.preventDefault();event.stopPropagation();window.location.reload();};}
  function addPreviewReturnButton(position){var where=position==='bottom'?'beforeend':'afterbegin';app.insertAdjacentHTML(where,previewReturnButtonMarkup(position));bindPreviewReturnButton();}
  function renderPreviewRolePicker() {
    document.body.classList.remove('system-lock-mode','preview-readonly');app.classList.remove('system-lock-view','virtual-preview-page');
    document.documentElement.classList.add('preview-role-selecting');
    var nav=document.getElementById('bottomNav');if(nav)nav.hidden=true;
    app.innerHTML=window.BasaltPreview.render(heading('ВИЗУАЛЬНЫЙ РЕЖИМ','Выберите роль','Предпросмотр только для просмотра. Данные и настройки не будут сохраняться.'));
    window.BasaltPreview.bind(app,function(previewRoleValue,roleTitle,baseRole,scenario){
      previewRole=baseRole||previewRoleValue;previewScenario=scenario||'normal';previewModeActive=true;currentRole=previewRole;isAdmin=previewRole==='admin';
      if(overview){overview.role=previewRole;overview.is_admin=isAdmin;if(overview.profile)overview.profile.role=previewRole;}
      if(profile)profile.role=previewRole;
      document.documentElement.classList.remove('preview-role-selecting');document.body.classList.add('preview-readonly');
      var nav=document.getElementById('bottomNav');if(nav)nav.hidden=false;
      var badge=document.getElementById('previewBadge');if(badge){badge.hidden=false;badge.textContent='ПРЕДПРОСМОТР · '+roleTitle;badge.style.display='block';}
      configureRoleNavigation();renderScreen('home');
    });
  }
  function renderGlobalLoadError(error) {
    globalLoadFailure = error || globalLoadFailure || new Error('api_request_failed');
    // Keep technical diagnostics in DevTools without exposing server details to users.
    if (window.console && console.error) console.error('Basalt WebApp bootstrap failed', {
      code: globalLoadFailure.code || globalLoadFailure.message || 'unknown',
      httpStatus: globalLoadFailure.httpStatus || null
    });
    var isDbTimeout = String(globalLoadFailure.code || '') === 'database_timeout';
    var detail = friendlyError(globalLoadFailure);
    var html;
    if (isDbTimeout) {
      html = heading('ПОДКЛЮЧЕНИЕ', 'Превышено время ожидания', 'База данных не успела ответить. Это может быть временная задержка соединения. Перезагрузите WebApp.');
      html += '<section class="empty global-server-error database-timeout-page"><div class="symbol">'+iconSvg('clock')+'</div><strong>Ответ базы данных задерживается</strong><p class="tiny">' + esc(detail) + '</p><button type="button" class="button secondary" id="globalServerRetry">Перезагрузить страницу</button></section>';
    } else {
      html = heading('ПОДКЛЮЧЕНИЕ', 'Сервис временно недоступен', 'Не удалось загрузить данные приложения. Все разделы, включая настройки, временно недоступны.');
      html += '<section class="empty global-server-error"><div class="symbol">!</div><strong>Не удалось загрузить приложение</strong><p class="tiny">' + esc(detail) + '</p><button type="button" class="button secondary" id="globalServerRetry">Повторить</button></section>';
    }
    app.innerHTML = translateHtml(html);
    app.classList.remove('screen-loading');
    app.style.minHeight = '';
    var retry = document.getElementById('globalServerRetry');
    if (retry) retry.onclick = function () { window.location.reload(); };
  }
  function toast(text) { var el=document.getElementById('toast'); el.textContent=text instanceof Error ? friendlyError(text) : friendlyError(text); el.classList.add('show'); window.clearTimeout(el._hideTimer); el._hideTimer=window.setTimeout(function(){el.classList.remove('show');},3200); }

  var FAILED_TG_AVATARS_KEY = 'basalt-failed-telegram-userpics-v1';
  var failedTelegramAvatarUrls = [];
  try {
    var storedFailedAvatarUrls = JSON.parse(localStorage.getItem(FAILED_TG_AVATARS_KEY) || '[]');
    if (Array.isArray(storedFailedAvatarUrls)) failedTelegramAvatarUrls = storedFailedAvatarUrls.filter(function (value) { return typeof value === 'string'; }).slice(-200);
  } catch (avatarCacheReadError) {}
  function normalizedTelegramUserpicUrl(value) {
    try {
      var parsed = new URL(String(value || ''), window.location.href);
      if (!/^t\.me$/i.test(parsed.hostname) || !/\/userpic\//i.test(parsed.pathname)) return '';
      return parsed.href;
    } catch (e) { return ''; }
  }
  function isTelegramUserpicUrl(value) { return !!normalizedTelegramUserpicUrl(value); }
  function hasFailedTelegramAvatar(value) {
    var normalized = normalizedTelegramUserpicUrl(value);
    return !!normalized && failedTelegramAvatarUrls.indexOf(normalized) !== -1;
  }
  function rememberFailedTelegramAvatar(value) {
    value = normalizedTelegramUserpicUrl(value);
    if (!value) return;
    failedTelegramAvatarUrls = failedTelegramAvatarUrls.filter(function (saved) { return saved !== value; });
    failedTelegramAvatarUrls.push(value);
    if (failedTelegramAvatarUrls.length > 200) failedTelegramAvatarUrls = failedTelegramAvatarUrls.slice(-200);
    try { localStorage.setItem(FAILED_TG_AVATARS_KEY, JSON.stringify(failedTelegramAvatarUrls)); } catch (avatarCacheWriteError) {}
  }
  function removeFailedAvatarImage(image, remember) {
    if (!image || !image.classList || !image.classList.contains('avatar-image')) return;
    var source = image.currentSrc || image.src || image.getAttribute('src') || '';
    if (remember) rememberFailedTelegramAvatar(source);
    if (image.__basaltAvatarTimer) { clearTimeout(image.__basaltAvatarTimer); image.__basaltAvatarTimer = null; }
    var shell = image.closest ? image.closest('.avatar-shell') : image.parentNode;
    if (shell && shell.classList) shell.classList.remove('has-photo', 'is-loaded');
    if (image.parentNode) image.parentNode.removeChild(image);
  }
  function watchTelegramAvatar(image) {
    if (!image || image.nodeType !== 1 || image.tagName !== 'IMG' || !image.classList.contains('avatar-image') || image.__basaltAvatarWatched) return;
    image.__basaltAvatarWatched = true;
    var source = image.getAttribute('src') || image.src || '';
    if (!isTelegramUserpicUrl(source)) return;
    if (hasFailedTelegramAvatar(source)) { removeFailedAvatarImage(image, false); return; }
    image.addEventListener('load', function () {
      if (image.__basaltAvatarTimer) { clearTimeout(image.__basaltAvatarTimer); image.__basaltAvatarTimer = null; }
    }, {once: true});
    image.addEventListener('error', function () {
      removeFailedAvatarImage(image, true);
    }, {once: true});
    image.__basaltAvatarTimer = setTimeout(function () {
      if (!image.isConnected) return;
      if (image.complete && image.naturalWidth > 0) return;
      removeFailedAvatarImage(image, true);
    }, 5000);
  }
  function watchTelegramAvatarsIn(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.matches && node.matches('img.avatar-image')) watchTelegramAvatar(node);
    if (node.querySelectorAll) node.querySelectorAll('img.avatar-image').forEach(watchTelegramAvatar);
  }
  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    var telegramAvatarObserver = new MutationObserver(function (records) {
      records.forEach(function (record) {
        record.addedNodes.forEach(watchTelegramAvatarsIn);
      });
    });
    telegramAvatarObserver.observe(document.documentElement, {childList: true, subtree: true});
  }
  document.addEventListener('error', function (event) {
    var image = event.target;
    if (!image || image.tagName !== 'IMG' || !image.classList || !image.classList.contains('avatar-image')) return;
    var source = image.currentSrc || image.src || image.getAttribute('src') || '';
    if (isTelegramUserpicUrl(source)) rememberFailedTelegramAvatar(source);
    if (image.__basaltAvatarTimer) { clearTimeout(image.__basaltAvatarTimer); image.__basaltAvatarTimer = null; }
  }, true);

  function initials(p) {
    p = p || {};
    var s = ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || String(p.username || p.tg_id || 'U');
    return s.split(/\s+/).slice(0, 2).map(function (x) { return x.charAt(0); }).join('').toUpperCase();
  }
  function photoUrl(p) {
    var unsafe = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) || initDataUser;
    var url = (p && p.photo_url) || (unsafe && unsafe.photo_url) || '';
    url = String(url || '');
    if (/^https?:\/\//i.test(url)) return url;
    if (/^\/?uploads\/avatars\/[a-f0-9]{64}\.(?:jpg|png|webp)$/i.test(url)) return url.charAt(0) === '/' ? url : '/' + url;
    return '';
  }
  function avatarMarkup(person, sizeClass, alt, eager) {
    var url = photoUrl(person);
    if (url && hasFailedTelegramAvatar(url)) url = '';
    // Hide the visual fallback immediately when a real URL exists. It is only revealed
    // again by the image error handler, so CSS ordering/load timing cannot cover Telegram's avatar.
    var letter = '<img class="avatar avatar-placeholder" src="assets/img/avatar-placeholder.webp?v=6" alt="?">';
    var image = url ? '<img class="avatar avatar-image" src="' + esc(url) + '" alt="' + esc(alt || '?') + '" decoding="async" loading="' + (eager ? 'eager' : 'lazy') + '" ' + (eager ? 'fetchpriority="high"' : 'fetchpriority="low"') + ' referrerpolicy="no-referrer">' : '';
    return '<span class="avatar-shell ' + esc(sizeClass || '') + (url ? ' has-photo' : ' no-photo') + '">' + letter + image + '</span>';
  }
  function localeTag() { return settings.language === 'en' ? 'en-US' : (settings.language === 'kz' ? 'kk-KZ' : 'ru-RU'); }
  function fmtDate(v) { if (!v) return '—'; var d=new Date(String(v).replace(' ','T')); if (isNaN(d.getTime())) return String(v); return d.toLocaleDateString(localeTag(),{day:'2-digit',month:'short',year:'numeric'}); }
  function fmtSize(n) { n=Number(n||0); return n>1048576?(n/1048576).toFixed(1)+(settings.language==='en'?' MB':' МБ'):Math.max(1,Math.round(n/1024))+(settings.language==='en'?' KB':' КБ'); }
  function fileStatusLabel(value) { var status=String(value||'').toLowerCase(); var labels={ready:'Обработан',processing:'Обрабатывается',error:'Ошибка',failed:'Ошибка',pending:'В очереди'}; return translateHtml(labels[status] || String(value||'—')); }
  function fmtMoney(n,c) { if(n===null||n===undefined||n==='')return translateHtml('Цена не распознана'); return Number(n).toLocaleString(localeTag(),{minimumFractionDigits:2,maximumFractionDigits:2})+' '+(c||'USD'); }
  function translateHtml(html) {
    var lang = settings.language || 'ru';
    if (lang === 'ru') return html.split('__BP_FIXED_RUSSIAN__').join('Русский');
    var en = {
      'Главная':'Home','Прайсы':'Price lists','Подписка':'Subscription','Настройки':'Settings',
      'ЛИЧНЫЙ КАБИНЕТ':'YOUR WORKSPACE','Парфюмерный центр':'Perfume Center',
      'Прайс-листы, поиск выгодных предложений и контроль подписки — в одном месте.':'Price lists, best-price search and subscription status in one place.',
      'Подписка активна':'Subscription active','Подписка не активна':'Subscription inactive','Предыдущая активная подписка деактивирована.':'The previous active subscription has been deactivated.','Доступ до':'Access until','Моя подписка ↗':'My subscription ↗',
      'Сводка каталога':'Catalog overview','Все прайсы ↗':'All price lists ↗','Прайс-листов':'Price lists','Позиций каталога':'Catalog items','Новых уведомлений':'New notifications','Дней осталось':'Days left',
      'Быстрый доступ':'Quick access','Прайс-листы':'Price lists','Файлы и результаты обработки':'Files and processing results','Поиск товаров':'Product search','Фильтры и сравнение цен':'Filters and price comparison','Уведомления':'Notifications','Обновления и статусы файлов':'Updates and file statuses','Поддержка':'Support','FAQ и связь с разработчиком':'FAQ and contact the developer',
      'РАБОТА С ДАННЫМИ':'YOUR DATA','Прайс-листы':'Price lists','Бот принимает Excel и CSV, распознаёт строки и собирает товары в единый каталог.':'Send Excel and CSV files to the bot to parse them into one catalog.',
      'Добавить новый прайс':'Add a price list','Отправьте документ боту в Telegram. После обработки данные появятся здесь.':'Send a document to the Telegram bot. Results will appear here after processing.',
      'Открыть чат с ботом ↗':'Open bot chat ↗','Ваши файлы':'Your files','файлов':'files','Каталог пока пуст':'Your catalog is empty','Добавьте первый прайс-лист через Telegram-бота.':'Add your first price list through the Telegram bot.','Перейти к боту':'Open bot',
      'Инструменты каталога':'Catalog tools','Поиск и фильтры':'Search and filters','Бренд, тип, цена и объём':'Brand, type, price and volume','Лучшие цены':'Best prices','Сравнение позиций в прайсах':'Compare items across price lists',
      'ДОСТУП И ТАРИФ':'ACCESS & PLAN','Ваша подписка':'Your subscription','Управляйте сроком доступа и получайте напоминания до окончания подписки.':'Manage access and get reminders before your subscription expires.',
      'Активна':'Active','Не активна':'Inactive','Все функции доступны':'All features are available','Требуется активация':'Activation required','Нет доступа':'No access','Активируйте ключ в Telegram-боте, чтобы начать работу.':'Activate a key in the Telegram bot to get started.',
      'Что включено':'What is included','Неограниченный каталог прайс-листов':'Price list catalog','Обработка файлов и единый список товаров':'File processing and unified product list','Поиск и сравнение цен':'Search and price comparison','Фильтры по бренду, типу и объёму':'Filters by brand, type and volume','Уведомления о сроке':'Expiry reminders','За 72 часа, затем каждые 24 часа до окончания':'72 hours before expiry, then every 24 hours','Продлить доступ':'Extend access','Ключ активации вводится в чате с ботом. Новый ключ активирует или продлевает доступ согласно настройкам подписки.':'Enter an activation key in the bot chat. A new key activates or extends access.','Перейти к активации в Telegram ↗':'Activate in Telegram ↗',
      'ПЕРСОНАЛИЗАЦИЯ':'PERSONALIZATION','Подстройте приложение под себя — от внешнего вида до уведомлений.':'Customize the app appearance and notifications.','Язык интерфейса':'Interface language','Язык':'Language','Выберите язык приложения':'Choose app language','Цветовая тема':'Color theme','Монохромная по умолчанию':'Monochrome by default','Режим отображения':'Appearance','Можно переключить любую тему на светлую или тёмную':'Switch any theme between light and dark','Тёмный':'Dark','Светлый':'Light','Системный':'System','Сохранить настройки':'Save settings',
      'Обновления приложения':'App updates','Новости, новые возможности и изменения':'News, new features and changes','Обработанные файлы':'Processed files','Результат загрузки и ошибки распознавания':'Upload results and parsing errors','Подписка':'Subscription','Напоминания за 72 часа и далее каждые 24 часа':'Reminders 72 hours before expiry and every 24 hours after','Открыть центр уведомлений ↗':'Open notification center ↗',
      'ЦЕНТР СОБЫТИЙ':'NOTIFICATION CENTER','Всё важное о прайс-листах, обновлениях и подписке — в одном списке.':'Important price-list, update and subscription events in one place.','Пока тихо':'All quiet for now','Новые события появятся здесь.':'New events will appear here.','Прочитано':'Read',
      'КАТАЛОГ':'CATALOG','Ищите по названию, бренду или артикулу и сортируйте результаты.':'Search by name, brand or SKU and sort results.','СРАВНЕНИЕ':'PRICE COMPARISON','Сравните найденные позиции по стоимости.':'Compare matching products by price.','Цена ↑':'Price ↑','Цена ↓':'Price ↓','Объём':'Volume','Порядок вывода':'Sort order','Сначала дешевле':'Lowest price first','Сначала дороже':'Highest price first','Сначала старые':'Oldest first','А–Я':'A–Z','Я–А':'Z–A','Интервал цен':'Price range','Клавиатура':'Keyboard','Ползунок':'Slider','Ничего не найдено':'No results found','Попробуйте другое название или загрузите ещё один прайс.':'Try another search or upload another price list.',
      'МЫ НА СВЯЗИ':'WE ARE HERE TO HELP','Поможем разобраться с обработкой прайсов, подпиской и возможностями приложения.':'Help with price-list processing, subscriptions and app features.','Связаться с разработчиком':'Contact developer','Вопросы, идеи и сообщения об ошибках':'Questions, ideas and bug reports','Частые вопросы':'Frequently asked questions',
      'Панель администратора':'Admin panel','Состояние сервиса и инструменты управления подписками.':'Service status and subscription management tools.','Создать ключи':'Generate keys','Количество':'Count','Срок, дней':'Duration, days','Сгенерировать ключи':'Generate keys','Ключи активации':'Activation keys','Всего: ':'Total: ','Ведутся':'In progress','Не назначено':'Not scheduled','Приватность продавца':'Seller privacy','Общедоступность товаров':'Public product visibility','Если выключено, товары скрыты от покупателей и обозначаются анонимно.':'When off, your products are hidden from buyers and shown anonymously.','Доступность личных сообщений':'Direct messages','Разрешить покупателям связываться с вами и отправлять списки избранного.':'Allow buyers to contact you and share their favorites.','Пользователи':'Users','Нет доступа':'No access','Панель доступна только администраторам.':'This panel is available to administrators only.',
      'Профиль Telegram':'Telegram profile','Пользователь Telegram':'Telegram user','Без username':'No username','Аватар':'Avatar','Прайс-лист обработан':'Price list processed','Прайс-лист удалён':'Price list deleted','Цена не распознана':'Price not recognized','Обработан':'Processed','Скачать':'Download','Удалить':'Delete','на проверку':'to review','товаров':'products','день':'day','дня':'days','дней':'days','Действует до':'Valid until','Доступ до:':'Access until:','Ключ:':'Key:','не активирован':'not activated','Доступ открыт':'Access enabled','Ожидает активации':'Awaiting activation','Опубликовать обновление':'Publish an update','Сообщение появится в центре уведомлений у пользователей, которые включили уведомления об обновлениях.':'The message will appear in notifications for users who enabled app updates.','Заголовок обновления':'Update title','Текст сообщения':'Message text','Опубликовать':'Publish','Активирован':'Activated','Свободен':'Available','Доступен':'Available','Использован':'Used','Строк на проверку':'Rows needing review','Строк обработано':'Rows processed','Например, Dior Sauvage или 100 ml':'For example, Dior Sauvage or 100 ml','тип не указан':'type not specified','объём не указан':'volume not specified','Наборы':'Sets','Tester':'Tester','Нужна проверка':'Needs review','Укажите BOT_USERNAME в конфигурации сайта и откройте чат с ботом.':'Set BOT_USERNAME in the site config, then open the bot chat.','Укажите DEVELOPER_USERNAME в конфигурации сайта.':'Set DEVELOPER_USERNAME in the site config.','Настройки сохранены':'Settings saved','Прайс-лист удалён':'Price list deleted','Ключи скопированы':'Keys copied','Ключ скопирован':'Key copied','Показать ключ':'Show key','Скрыть ключ':'Hide key','Полный ключ недоступен для старых записей.':'The full key is unavailable for older records.','Полный ключ не сохранялся для старых записей':'Full values were not stored for older keys','Не удалось скопировать ключи. Выделите их и скопируйте вручную.':'Could not copy the keys. Select and copy them manually.','Не удалось скопировать ключ. Попробуйте выделить его вручную.':'Could not copy the key. Select and copy it manually.','Создано ключей: ':'Keys created: ','Как загрузить прайс-лист?':'How do I upload a price list?','Отправьте Excel или CSV документом боту. После обработки результаты появятся в приложении.':'Send an Excel or CSV file to the bot as a document. Results will appear in the app after processing.','Почему часть строк требует проверки?':'Why do some rows need review?','Цена или название не распознаны однозначно. Такие значения сохраняются для ручной проверки.':'The price or name could not be identified confidently. These entries are saved for manual review.','Когда придёт напоминание о подписке?':'When will I get a subscription reminder?','Сколько времени обрабатывается один файл?':'How long does one file take to process?','Обычно обработка одного файла занимает примерно 3–5 минут. Время зависит от размера прайс-листа и количества строк.':'Processing one file usually takes about 3–5 minutes. The time depends on the price list size and the number of rows.','Как обрабатываются конфликтные файлы?':'How are conflicting files handled?','Если новый прайс-лист конфликтует с уже загруженным (например, это другая версия того же прайса), бот предложит выбрать действие для конфликтующих файлов. Чтобы обновление прошло максимально надёжно и заняло меньше времени, заранее удалите старый конфликтующий прайс-лист на странице «Прайс-листы», а затем загрузите новый.':'If a new price list conflicts with one already uploaded (for example, it is another version of the same list), the bot will ask you to choose an action for the conflicting files. For the most reliable update in less time, delete the old conflicting price list on the “Price lists” page before uploading the new one.','При включённых уведомлениях: за 72 часа до окончания и далее каждые 24 часа.':'When notifications are enabled: 72 hours before expiry and every 24 hours thereafter.','Товары скрыты':'Products hidden','Товаров: ':'Products: ','Какие форматы поддерживаются?':'Which formats are supported?','Срок вашей подписки истёк. Отправьте /start боту, чтобы активировать новый ключ.':'Your subscription has expired. Send /start to the bot to activate a new key.','До окончания доступа осталось около':'About this much time remains before access expires:','Продлите подписку заранее, чтобы не потерять доступ.':'Renew in advance to keep access.',
      'Профиль Telegram':'Telegram profile','Без username':'No username','Удалить прайс-лист из каталога?':'Delete this price list from the catalogue?','Запись прайс-листа удалена из каталога.':'The price list record was removed from the catalogue.','строк':'rows','замечаний':'warnings','Подписка закончилась':'Subscription expired','Скоро закончится подписка':'Subscription expiring soon','До окончания подписки осталось около':'Time left until subscription expires:','ч.':'h','Откройте через Telegram':'Open through Telegram','Для безопасной авторизации откройте приложение кнопкой WebApp в чате с ботом.':'For secure sign-in, open the WebApp using the button in the bot chat.','Нужен запуск из Telegram':'Telegram launch required','Telegram передаёт подписанные данные пользователя. Обычное открытие ссылки в браузере не авторизует аккаунт.':'Telegram supplies signed user data. Opening the link in a regular browser does not authenticate you.','ПОДКЛЮЧЕНИЕ':'CONNECTION','Не удалось войти':'Sign-in failed','Проверьте настройки сайта и откройте приложение заново из Telegram.':'Check the site settings and reopen the app from Telegram.','Загружаем экран…':'Loading screen…','Не удалось загрузить экран':'Could not load screen','Повторить':'Retry','Активные подписки':'Active subscriptions','Копировать ключи':'Copy keys','Скопируйте ключи сейчас: полные значения показываются только один раз.':'Copy the keys now; full values are shown only once.','Уведомление отправлено: ':'Notification sent: ','Прайс-лист принят':'Price list received','не активирован':'not activated','с файла':'from file','—':'—',
      'Фильтры':'Filters',
      'Порядок вывода':'Sort order',
      'Сначала дешевле':'Lowest price first',
      'Сначала дороже':'Highest price first',
      'Сначала старые':'Oldest first',
      'А–Я':'A–Z',
      'Интервал цен':'Price range',
      'Клавиатура':'Keyboard',
      'Ползунок':'Slider',
      'ТОЧНЫЙ ПОИСК':'PRECISE SEARCH',
      'Фильтры каталога':'Catalogue filters',
      'Комбинируй условия — результаты обновятся после применения.':'Combine conditions; results update after applying.',
      'Бренд':'Brand',
      'Объём':'Volume',
      'Тип / концентрация':'Type / concentration',
      'Прайс-лист':'Price list',
      'Пол':'Gender',
      'Категория':'Category',
      'Тестер':'Tester',
      'Набор':'Set / bundle',
      'Проверка парсинга':'Parsing review',
      'Цена от':'Minimum price',
      'Цена до':'Maximum price',
      'Все':'All',
      'Нет, обычный товар':'No, regular item',
      'Да, tester':'Yes, tester',
      'Одиночный товар':'Single item',
      'Набор / комплект':'Set / bundle',
      'Без проверки':'No review needed',
      'Требует проверки':'Needs review',
      'Сбросить':'Reset',
      'Показать результаты':'Apply filters',
      'Без дополнительных фильтров':'No additional filters',
      'Сначала новые':'Newest first',
      'Мужской':'Male',
      'Женский':'Female',
      'Унисекс':'Unisex',
      'файл':'file',
      'Не набор':'Not a set',
      'Без tester':'Non-tester',
      'на проверку':'needs review',
      'проверенные':'reviewed',
      'Измени условия или сбрось часть фильтров.':'Change conditions or reset some filters.',
      'позиции в текущей выдаче (максимум 100)':'items in current results (maximum 100)',
      'Парфюмерия':'Perfume',
      'Косметика':'Cosmetics',
      "Скачать все": "Download all",
      "Скачать все обработанные прайс-листы одним действием": "Download all processed price lists at once",
      "Применить язык в Telegram": "Apply language in Telegram",
      "Не удалось связаться с сервером": "Could not connect to the server",
      "Не удалось скопировать ключ": "Could not copy key",
      "Подписка не применена": "Subscription not applied",
      "Подписка применена": "Subscription applied",
      "Заменить и обработать": "Replace and process",
      "Отменить группу": "Cancel batch",
      "Файл уже существует": "File already exists",
      "Аватар пользователя": "User avatar",
      "В приложении нет обработанных файлов для скачивания.": "There are no processed files to download.",
      "Применить язык": "Apply language",
      "Не удалось подготовить файл.": "Could not prepare the file.",
      "Поддерживаемые форматы: Excel и CSV": "Supported formats: Excel and CSV",
      "Назад": "Back",
      "Активировать / продлить ключ": "Activate / renew key",
      "Как загрузить прайс-лист": "How to upload a price list",
      "Подписка активирована": "Subscription activated",
      "Подписка не активирована": "Subscription was not activated",
      "Файл уже есть в каталоге. Заменить его?": "This file already exists in the catalog. Replace it?",
      "Обрабатываю группу из": "Processing a group of",
      "Вернуться в WebApp": "Return to WebApp",
      "ОК": "OK",
      "Сначала загрузите прайс-лист.": "Upload a price list first.",
      "Скачать файл": "Download file",
      "Скачать все прайсы": "Download all price lists",
      "Не удалось открыть Telegram.": "Could not open Telegram.",
      "Ошибка обработки файла": "File processing error",
      "Файл принят в обработку": "File accepted for processing",
      "Отправьте ключ сообщением в этот чат.": "Send the key as a message in this chat.",
      "Включено": "Enabled",
      "Выключено": "Disabled",
      "Открыть центр уведомлений": "Open notifications",
      "Действует до:": "Valid until:",
      "Загрузить файл": "Upload file",
      "Сохранить изменения": "Save changes",
      "Применить": "Apply",
      "Отмена": "Cancel",
      "Дней": "Days",
      "Позиции": "Items",
      "Товарных строк": "Product rows",
      "Пожалуйста, подождите": "Please wait",
      "Обрабатывается": "Processing",
      "Пожалуйста, повторите попытку": "Please try again",
      "Нет результатов": "No results",
      "Попробуйте изменить поисковый запрос": "Try changing your search query",
      "Не найдено": "Not found",
      "Нужно проверить": "Needs review",
      "Файл уже существует. Заменить?": "This file already exists. Replace it?",
      "Продолжить": "Continue",
      "Очистить": "Clear",
      "Поиск": "Search",
      "Сбросить фильтры": "Reset filters",
      "Выбрать": "Select",
      "Все категории": "All categories",
      "Найдено": "Found",
      "Подробности": "Details",
      "В очереди": "Queued",
      "Ошибка": "Error",
      "Важное о прайс-листах, подписке и обновлениях.": "Important information about price lists, your subscription and updates.",
      "Ищите по названию, бренду, артикулу или любому фрагменту наименования.": "Search by name, brand, SKU or any part of a product name.",
      "Разделы фильтров": "Filter sections",
      "Способ выбора цены": "Price selection method",
      "Минимальная цена": "Minimum price",
      "Максимальная цена": "Maximum price",
      "Без лимита": "No limit",
      "Потяните вниз, чтобы закрыть": "Pull down to close",
      "Полный ключ не сохранялся для этой старой записи. Восстановить его из хеша нельзя.": "The full key was not stored for this older record and cannot be recovered from its hash.",
      "Не удалось расшифровать ключ. Проверьте прежний KEY_ENCRYPTION_SECRET, BOT_TOKEN и пароль БД.": "Could not decrypt the key. Check the previous KEY_ENCRYPTION_SECRET, BOT_TOKEN and database password.",
      "Русский": "Russian",
      "Қазақша": "Kazakh",
      "Ағылшын": "English"
    };
    var kz = {
      'Главная':'Басты','Прайсы':'Прайс-парақтар','Подписка':'Жазылым','Настройки':'Баптаулар',
      'ЛИЧНЫЙ КАБИНЕТ':'ЖЕКЕ КАБИНЕТ','Парфюмерный центр':'Парфюмерия орталығы','Сводка каталога':'Каталог шолуы','Быстрый доступ':'Жылдам қолжетімділік',
      'Прайс-листы':'Прайс-парақтар','Поиск товаров':'Тауар іздеу','Уведомления':'Хабарландырулар','Поддержка':'Қолдау','Настройки':'Баптаулар',
      'ДОСТУП И ТАРИФ':'ҚОЛЖЕТІМДІЛІК ЖӘНЕ ТАРИФ','Ваша подписка':'Жазылымыңыз','Что включено':'Не кіреді','Продлить доступ':'Қолжетімділікті ұзарту',
      'ПЕРСОНАЛИЗАЦИЯ':'ЖЕКЕЛЕНДІРУ','Язык интерфейса':'Интерфейс тілі','Цветовая тема':'Түс тақырыбы','Режим отображения':'Көрініс режимі','Сохранить настройки':'Баптауларды сақтау',
      'ЦЕНТР СОБЫТИЙ':'ХАБАРЛАНДЫРУЛАР','Частые вопросы':'Жиі қойылатын сұрақтар','Пользователи':'Пайдаланушылар','Создать ключи':'Кілттер жасау','Сгенерировать ключи':'Кілттер жасау',
      'Прайс-листы, поиск выгодных предложений и контроль подписки — в одном месте.':'Прайс-парақтар, тиімді ұсыныстарды іздеу және жазылымды басқару — бір жерде.','Подписка активна':'Жазылым белсенді','Подписка не активна':'Жазылым белсенді емес','Предыдущая активная подписка деактивирована.':'Алдыңғы белсенді жазылым өшірілді.','Доступ до':'Қолжетімділік мерзімі','Моя подписка ↗':'Жазылымым ↗','Все прайсы ↗':'Барлық прайс-парақтар ↗','Прайс-листов':'Прайс-парақтар','Позиций каталога':'Каталогтағы тауарлар','Новых уведомлений':'Жаңа хабарландырулар','Дней осталось':'Қалған күндер','Файлы и результаты обработки':'Файлдар және өңдеу нәтижелері','Фильтры и сравнение цен':'Сүзгілер және бағаларды салыстыру','Обновления и статусы файлов':'Жаңартулар және файл күйлері','FAQ и связь с разработчиком':'FAQ және әзірлеушімен байланыс','РАБОТА С ДАННЫМИ':'ДЕРЕКТЕРМЕН ЖҰМЫС','Бот принимает Excel и CSV, распознаёт строки и собирает товары в единый каталог.':'Бот Excel және CSV файлдарын қабылдап, жолдарды таниды және тауарларды бір каталогқа біріктіреді.','Добавить новый прайс':'Жаңа прайс-парақ қосу','Отправьте документ боту в Telegram. После обработки данные появятся здесь.':'Құжатты Telegram боты арқылы жіберіңіз. Өңделгеннен кейін деректер осында пайда болады.','Открыть чат с ботом ↗':'Ботпен чатты ашу ↗','Ваши файлы':'Файлдарыңыз','файлов':'файл','Каталог пока пуст':'Каталог әзірге бос','Добавьте первый прайс-лист через Telegram-бота.':'Алғашқы прайс-парақты Telegram боты арқылы қосыңыз.','Перейти к боту':'Ботқа өту','Инструменты каталога':'Каталог құралдары','Поиск и фильтры':'Іздеу және сүзгілер','Бренд, тип, цена и объём':'Бренд, түрі, бағасы және көлемі','Лучшие цены':'Ең тиімді бағалар','Сравнение позиций в прайсах':'Прайс-парақтардағы тауарларды салыстыру','ДОСТУП И ТАРИФ':'ҚОЛЖЕТІМДІЛІК ЖӘНЕ ТАРИФ','Управляйте сроком доступа и получайте напоминания до окончания подписки.':'Қолжетімділік мерзімін басқарып, жазылым аяқталмай тұрып еске салулар алыңыз.','Активна':'Белсенді','Не активна':'Белсенді емес','Все функции доступны':'Барлық функция қолжетімді','Требуется активация':'Белсендіру қажет','Нет доступа':'Қолжетімділік жоқ','Активируйте ключ в Telegram-боте, чтобы начать работу.':'Жұмысты бастау үшін Telegram ботында кілтті белсендіріңіз.','Неограниченный каталог прайс-листов':'Прайс-парақтардың шектеусіз каталогы','Обработка файлов и единый список товаров':'Файлдарды өңдеу және бірыңғай тауарлар тізімі','Поиск и сравнение цен':'Іздеу және бағаларды салыстыру','Фильтры по бренду, типу и объёму':'Бренд, түрі және көлемі бойынша сүзгілер','Уведомления о сроке':'Мерзім туралы хабарландырулар','За 72 часа, затем каждые 24 часа до окончания':'72 сағат бұрын, одан кейін мерзімі біткенше әр 24 сағат сайын','Ключ активации вводится в чате с ботом. Новый ключ активирует или продлевает доступ согласно настройкам подписки.':'Белсендіру кілтін бот чатында енгізіңіз. Жаңа кілт қолжетімділікті белсендіреді немесе жазылымды ұзартады.','Перейти к активации в Telegram ↗':'Telegram арқылы белсендіру ↗','Подстройте приложение под себя — от внешнего вида до уведомлений.':'Қосымшаның көрінісі мен хабарландыруларын өзіңізге ыңғайлаңыз.','Язык':'Тіл','Выберите язык приложения':'Қосымша тілін таңдаңыз','Монохромная по умолчанию':'Әдепкіде монохром','Можно переключить любую тему на светлую или тёмную':'Кез келген тақырыпты ашық немесе қараңғы режимге ауыстыруға болады','Тёмный':'Қараңғы','Светлый':'Ашық','Системный':'Жүйелік','Обновления приложения':'Қосымша жаңартулары','Новости, новые возможности и изменения':'Жаңалықтар, жаңа мүмкіндіктер және өзгерістер','Обработанные файлы':'Өңделген файлдар','Результат загрузки и ошибки распознавания':'Жүктеу нәтижесі және тану қателері','Напоминания за 72 часа и далее каждые 24 часа':'72 сағат бұрын және одан кейін әр 24 сағат сайын еске салу','Открыть центр уведомлений ↗':'Хабарландырулар орталығын ашу ↗','Всё важное о прайс-листах, обновлениях и подписке — в одном списке.':'Прайс-парақтар, жаңартулар және жазылым туралы маңызды ақпарат бір тізімде.','Пока тихо':'Әзірге хабарландыру жоқ','Новые события появятся здесь.':'Жаңа оқиғалар осында көрсетіледі.','Прочитано':'Оқылды','Ищите по названию, бренду или артикулу и сортируйте результаты.':'Атауы, бренді немесе артикулы бойынша іздеп, нәтижелерді сұрыптаңыз.','Сравните найденные позиции по стоимости.':'Табылған тауарлардың бағаларын салыстырыңыз.','Цена ↑':'Баға ↑','Цена ↓':'Баға ↓','Объём':'Көлем','Порядок вывода':'Сұрыптау реті','Сначала дешевле':'Алдымен арзандары','Сначала дороже':'Алдымен қымбаттары','Сначала старые':'Алдымен ескілері','А–Я':'A–Z','Я–А':'Z–A','Интервал цен':'Баға аралығы','Клавиатура':'Пернетақта','Ползунок':'Сырғытпа','Ничего не найдено':'Ештеңе табылмады','Попробуйте другое название или загрузите ещё один прайс.':'Басқа атауды іздеп көріңіз немесе тағы бір прайс-парақ қосыңыз.','МЫ НА СВЯЗИ':'БАЙЛАНЫСТАМЫЗ','Поможем разобраться с обработкой прайсов, подпиской и возможностями приложения.':'Прайс-парақтарды өңдеу, жазылым және қосымша мүмкіндіктері бойынша көмектесеміз.','Связаться с разработчиком':'Әзірлеушімен байланысу','Вопросы, идеи и сообщения об ошибках':'Сұрақтар, ұсыныстар және қателер туралы хабарламалар','Панель администратора':'Әкімші панелі','Состояние сервиса и инструменты управления подписками.':'Қызмет күйі және жазылымдарды басқару құралдары.','Количество':'Саны','Срок, дней':'Мерзімі, күн','Ключи активации':'Белсендіру кілттері','Всего: ':'Барлығы: ','Ведутся':'Жүріп жатыр','Не назначено':'Тағайындалмаған','Приватность продавца':'Сатушы құпиялығы','Общедоступность товаров':'Тауарлардың жалпыға қолжетімділігі','Если выключено, товары скрыты от покупателей и обозначаются анонимно.':'Өшірулі болса, тауарлар сатып алушылардан жасырылады және анонимді көрсетіледі.','Доступность личных сообщений':'Жеке хабарламаларға рұқсат','Разрешить покупателям связываться с вами и отправлять списки избранного.':'Сатып алушыларға сізбен байланысуға және таңдаулылар тізімін жіберуге рұқсат беру.','Сгенерировать ключи':'Кілттер жасау','Панель доступна только администраторам.':'Бұл панель тек әкімшілерге қолжетімді.','Профиль Telegram':'Telegram профилі','Пользователь Telegram':'Telegram пайдаланушысы','Без username':'Username жоқ','Прайс-лист обработан':'Прайс-парақ өңделді','Прайс-лист удалён':'Прайс-парақ жойылды','Цена не распознана':'Баға танылмады','Обработан':'Өңделді','Скачать':'Жүктеу','Удалить':'Жою','на проверку':'тексеруге','товаров':'тауар','день':'күн','дня':'күн','дней':'күн','Действует до':'Мерзімі аяқталады','Ключ:':'Кілт:','не активирован':'белсендірілмеген','Доступ открыт':'Қолжетімділік ашық','Ожидает активации':'Белсендіруді күтуде','Опубликовать обновление':'Жаңартуды жариялау','Заголовок обновления':'Жаңарту тақырыбы','Текст сообщения':'Хабарлама мәтіні','Опубликовать':'Жариялау','Активирован':'Белсендірілді','Свободен':'Бос','Доступен':'Қолжетімді','Использован':'Пайдаланылды','Строк на проверку':'Тексеруді қажет ететін жолдар','Например, Dior Sauvage или 100 ml':'Мысалы, Dior Sauvage немесе 100 ml','тип не указан':'түрі көрсетілмеген','объём не указан':'көлемі көрсетілмеген','Наборы':'Жиынтықтар','Нужна проверка':'Тексеру қажет','Настройки сохранены':'Баптаулар сақталды','Ключи скопированы':'Кілттер көшірілді','Ключ скопирован':'Кілт көшірілді','Показать ключ':'Кілтті көрсету','Скрыть ключ':'Кілтті жасыру','Полный ключ недоступен для старых записей.':'Ескі жазбалардың толық кілті қолжетімсіз.','Полный ключ не сохранялся для старых записей':'Ескі кілттердің толық мәні сақталмаған','Не удалось скопировать ключи. Выделите их и скопируйте вручную.':'Кілттерді көшіру мүмкін болмады. Оларды белгілеп, қолмен көшіріңіз.','Не удалось скопировать ключ. Попробуйте выделить его вручную.':'Кілтті көшіру мүмкін болмады. Оны белгілеп, қолмен көшіріңіз.','Как загрузить прайс-лист?':'Прайс-парақты қалай жүктеуге болады?','Отправьте Excel или CSV документом боту. После обработки результаты появятся в приложении.':'Excel немесе CSV файлын ботқа құжат ретінде жіберіңіз. Өңделгеннен кейін нәтижелер қосымшада көрсетіледі.','Почему часть строк требует проверки?':'Неліктен кейбір жолдарды тексеру керек?','Цена или название не распознаны однозначно. Такие значения сохраняются для ручной проверки.':'Баға немесе атау нақты танылмады. Мұндай жазбалар қолмен тексеру үшін сақталады.','Когда придёт напоминание о подписке?':'Жазылым туралы еске салу қашан келеді?','Сколько времени обрабатывается один файл?':'Бір файлды өңдеу қанша уақыт алады?','Обычно обработка одного файла занимает примерно 3–5 минут. Время зависит от размера прайс-листа и количества строк.':'Әдетте бір файлды өңдеу шамамен 3–5 минут алады. Уақыт прайс-парақтың көлеміне және жолдар санына байланысты.','Как обрабатываются конфликтные файлы?':'Қайшылықты файлдар қалай өңделеді?','Если новый прайс-лист конфликтует с уже загруженным (например, это другая версия того же прайса), бот предложит выбрать действие для конфликтующих файлов. Чтобы обновление прошло максимально надёжно и заняло меньше времени, заранее удалите старый конфликтующий прайс-лист на странице «Прайс-листы», а затем загрузите новый.':'Жаңа прайс-парақ бұрын жүктелген файлмен қайшы келсе (мысалы, сол прайс-парақтың басқа нұсқасы болса), бот қайшылықты файлдар үшін әрекетті таңдауды ұсынады. Жаңартуды сенімдірек орындап, уақытты үнемдеу үшін жаңасын жүктемес бұрын «Прайс-парақтар» бетінен ескі қайшылықты файлды жойыңыз.','При включённых уведомлениях: за 72 часа до окончания и далее каждые 24 часа.':'Хабарландырулар қосулы болса: аяқталуына 72 сағат қалғанда және одан кейін әр 24 сағат сайын.','Товары скрыты':'Тауарлар жасырылған','Товаров: ':'Тауар саны: ','Какие форматы поддерживаются?':'Қандай пішімдерге қолдау көрсетіледі?','Срок вашей подписки истёк. Отправьте /start боту, чтобы активировать новый ключ.':'Жазылым мерзімі аяқталды. Жаңа кілтті белсендіру үшін ботқа /start жіберіңіз.','Tester':'Tester','Аватар':'Аватар','До окончания доступа осталось около':'Қолжетімділік аяқталуына шамамен','Продлите подписку заранее, чтобы не потерять доступ.':'Қолжетімділікті жоғалтпау үшін жазылымды алдын ала ұзартыңыз.','КАТАЛОГ':'КАТАЛОГ','СРАВНЕНИЕ':'САЛЫСТЫРУ','Создано ключей: ':'Жасалған кілттер: ','Сообщение появится в центре уведомлений у пользователей, которые включили уведомления об обновлениях.':'Хабарлама жаңартулар туралы хабарландыруды қосқан пайдаланушылардың хабарландыру орталығында көрсетіледі.','Строк обработано':'Өңделген жолдар','Укажите BOT_USERNAME в конфигурации сайта и откройте чат с ботом.':'Сайт конфигурациясында BOT_USERNAME мәнін көрсетіп, ботпен чатты ашыңыз.','Укажите DEVELOPER_USERNAME в конфигурации сайта.':'Сайт конфигурациясында DEVELOPER_USERNAME мәнін көрсетіңіз.',
      'Профиль Telegram':'Telegram профилі','Без username':'Username жоқ','Удалить прайс-лист из каталога?':'Бұл прайс-парақ каталогтан жойылсын ба?','Запись прайс-листа удалена из каталога.':'Прайс-парақ жазбасы каталогтан жойылды.','строк':'жол','замечаний':'ескерту','Подписка закончилась':'Жазылым аяқталды','Скоро закончится подписка':'Жазылым жақында аяқталады','До окончания подписки осталось около':'Жазылым аяқталуына шамамен','ч.':'сағ.','Откройте через Telegram':'Telegram арқылы ашыңыз','Для безопасной авторизации откройте приложение кнопкой WebApp в чате с ботом.':'Қауіпсіз кіру үшін WebApp қосымшасын бот чатындағы батырма арқылы ашыңыз.','Нужен запуск из Telegram':'Telegram арқылы іске қосу қажет','Telegram передаёт подписанные данные пользователя. Обычное открытие ссылки в браузере не авторизует аккаунт.':'Telegram қолтаңбамен расталған пайдаланушы деректерін береді. Сілтемені браузерде ашу аккаунтқа кіргізбейді.','ПОДКЛЮЧЕНИЕ':'БАЙЛАНЫС','Не удалось войти':'Кіру мүмкін болмады','Проверьте настройки сайта и откройте приложение заново из Telegram.':'Сайт баптауларын тексеріп, қосымшаны Telegram арқылы қайта ашыңыз.','Загружаем экран…':'Экран жүктелуде…','Не удалось загрузить экран':'Экран жүктелмеді','Повторить':'Қайталау','Активные подписки':'Белсенді жазылымдар','Копировать ключи':'Кілттерді көшіру','Скопируйте ключи сейчас: полные значения показываются только один раз.':'Кілттерді қазір көшіріп алыңыз: толық мәндер бір рет қана көрсетіледі.','Уведомление отправлено: ':'Хабарландыру жіберілді: ','Прайс-лист принят':'Прайс-парақ қабылданды','с файла':'файлдан','—':'—',
      'Фильтры':'Сүзгілер',
      'Порядок вывода':'Сұрыптау реті',
      'Сначала дешевле':'Алдымен арзандары',
      'Сначала дороже':'Алдымен қымбаттары',
      'Сначала старые':'Алдымен ескілері',
      'А–Я':'A–Z',
      'Интервал цен':'Баға аралығы',
      'Клавиатура':'Пернетақта',
      'Ползунок':'Сырғытпа',
      'ТОЧНЫЙ ПОИСК':'НАҚТЫ ІЗДЕУ',
      'Фильтры каталога':'Каталог сүзгілері',
      'Комбинируй условия — результаты обновятся после применения.':'Шарттарды біріктіріңіз; қолданғаннан кейін нәтижелер жаңартылады.',
      'Бренд':'Бренд',
      'Объём':'Көлем',
      'Тип / концентрация':'Түрі / концентрация',
      'Прайс-лист':'Прайс-парақ',
      'Пол':'Жынысы',
      'Категория':'Санат',
      'Тестер':'Тестер',
      'Набор':'Жиынтық',
      'Проверка парсинга':'Өңдеуді тексеру',
      'Цена от':'Ең төменгі баға',
      'Цена до':'Ең жоғары баға',
      'Все':'Барлығы',
      'Нет, обычный товар':'Жоқ, кәдімгі тауар',
      'Да, tester':'Иә, тестер',
      'Одиночный товар':'Жеке тауар',
      'Набор / комплект':'Жиынтық',
      'Без проверки':'Тексеру қажет емес',
      'Требует проверки':'Тексеру қажет',
      'Сбросить':'Тазарту',
      'Показать результаты':'Нәтижелерді көрсету',
      'Без дополнительных фильтров':'Қосымша сүзгілер жоқ',
      'Сначала новые':'Алдымен жаңалары',
      'Мужской':'Ерлерге арналған',
      'Женский':'Әйелдерге арналған',
      'Унисекс':'Унисекс',
      'файл':'файл',
      'Не набор':'Жиынтық емес',
      'Без tester':'Тестер емес',
      'на проверку':'тексеру қажет',
      'проверенные':'тексерілген',
      'Измени условия или сбрось часть фильтров.':'Шарттарды өзгертіңіз немесе кейбір сүзгілерді тазалаңыз.',
      'позиции в текущей выдаче (максимум 100)':'ағымдағы нәтижедегі тауар (ең көбі 100)',
      'Парфюмерия':'Парфюмерия',
      'Косметика':'Косметика',
      "Скачать все": "Барлығын жүктеу",
      "Скачать все обработанные прайс-листы одним действием": "Өңделген барлық прайс-парақты бір әрекетпен жүктеу",
      "Применить язык в Telegram": "Telegram тілін қолдану",
      "Не удалось связаться с сервером": "Серверге қосылу мүмкін болмады",
      "Не удалось скопировать ключ": "Кілтті көшіру мүмкін болмады",
      "Подписка не применена": "Жазылым қолданылмады",
      "Подписка применена": "Жазылым қолданылды",
      "Заменить и обработать": "Ауыстыру және өңдеу",
      "Отменить группу": "Топтан бас тарту",
      "Файл уже существует": "Файл бұрыннан бар",
      "Аватар пользователя": "Пайдаланушы аватары",
      "В приложении нет обработанных файлов для скачивания.": "Қосымшада жүктеуге дайын өңделген файлдар жоқ.",
      "Применить язык": "Тілді қолдану",
      "Не удалось подготовить файл.": "Файлды дайындау мүмкін болмады.",
      "Поддерживаемые форматы: Excel и CSV": "Қолдау көрсетілетін пішімдер: Excel және CSV",
      "Назад": "Артқа",
      "Активировать / продлить ключ": "Кілтті белсендіру / ұзарту",
      "Как загрузить прайс-лист": "Прайс-парақты қалай жүктеуге болады",
      "Подписка активирована": "Жазылым белсендірілді",
      "Подписка не активирована": "Жазылым белсендірілмеді",
      "Файл уже есть в каталоге. Заменить его?": "Бұл файл каталогта бар. Оны ауыстыру керек пе?",
      "Обрабатываю группу из": "Топ өңделуде:",
      "Вернуться в WebApp": "WebApp-қа оралу",
      "ОК": "Жарайды",
      "Сначала загрузите прайс-лист.": "Алдымен прайс-парақты жүктеңіз.",
      "Скачать файл": "Файлды жүктеу",
      "Скачать все прайсы": "Барлық прайс-парақтарды жүктеу",
      "Не удалось открыть Telegram.": "Telegram ашылмады.",
      "Ошибка обработки файла": "Файлды өңдеу қатесі",
      "Файл принят в обработку": "Файл өңдеуге қабылданды",
      "Отправьте ключ сообщением в этот чат.": "Кілтті осы чатқа хабарлама ретінде жіберіңіз.",
      "Включено": "Қосулы",
      "Выключено": "Өшірулі",
      "Действует до:": "Мерзімі:",
      "Загрузить файл": "Файлды жүктеу",
      "Сохранить изменения": "Өзгерістерді сақтау",
      "Применить": "Қолдану",
      "Отмена": "Бас тарту",
      "Дней": "Күн",
      "Позиции": "Тауарлар",
      "Товарных строк": "Тауар жолдары",
      "Пожалуйста, подождите": "Күте тұрыңыз",
      "Обрабатывается": "Өңделуде",
      "Пожалуйста, повторите попытку": "Қайталап көріңіз",
      "Нет результатов": "Нәтиже жоқ",
      "Попробуйте изменить поисковый запрос": "Іздеу сұрауын өзгертіп көріңіз",
      "Не найдено": "Табылмады",
      "Нужно проверить": "Тексеру қажет",
      "Файл уже существует. Заменить?": "Бұл файл бұрыннан бар. Ауыстырайық па?",
      "Продолжить": "Жалғастыру",
      "Очистить": "Тазалау",
      "Поиск": "Іздеу",
      "Сбросить фильтры": "Сүзгілерді тазалау",
      "Выбрать": "Таңдау",
      "Все категории": "Барлық санаттар",
      "Найдено": "Табылды",
      "Подробности": "Толығырақ",
      'Доступ до:':'Қолжетімділік мерзімі:',
      'Открыть центр уведомлений':'Хабарландырулар орталығын ашу',
      "В очереди": "Кезекте",
      "Ошибка": "Қате",
      "Важное о прайс-листах, подписке и обновлениях.": "Прайс-парақтар, жазылым және жаңартулар туралы маңызды ақпарат.",
      "Ищите по названию, бренду, артикулу или любому фрагменту наименования.": "Атауы, бренді, артикулы немесе атаудың кез келген бөлігі бойынша іздеңіз.",
      "Разделы фильтров": "Сүзгі бөлімдері",
      "Способ выбора цены": "Бағаны таңдау тәсілі",
      "Минимальная цена": "Ең төменгі баға",
      "Максимальная цена": "Ең жоғары баға",
      "Без лимита": "Шектеусіз",
      "Потяните вниз, чтобы закрыть": "Жабу үшін төмен қарай тартыңыз",
      "Полный ключ не сохранялся для этой старой записи. Восстановить его из хеша нельзя.": "Бұл ескі жазбаның толық кілті сақталмаған, оны хэштен қалпына келтіру мүмкін емес.",
      "Не удалось расшифровать ключ. Проверьте прежний KEY_ENCRYPTION_SECRET, BOT_TOKEN и пароль БД.": "Кілтті ашу мүмкін болмады. Бұрынғы KEY_ENCRYPTION_SECRET, BOT_TOKEN және дерекқор құпиясөзін тексеріңіз.",
      "Русский": "Орысша",
      "Қазақша": "Қазақша",
      "Ағылшын": "Ағылшынша"
    };
    var map = lang === 'kz' ? kz : en;
    Object.keys(map).sort(function(a,b){return b.length-a.length;}).forEach(function(key){html=html.split(key).join(map[key]);});
    return html.split('__BP_FIXED_RUSSIAN__').join('Русский');
  }
  function configureRoleNavigation() {
    var navEl=document.getElementById('bottomNav'); if(!navEl) return;
    var priceButton=navEl.querySelector('[data-nav-primary]');
    if(priceButton){var targetNavScreen=currentRole==='buyer'?'search':'prices';if(priceButton.getAttribute('data-screen')!==targetNavScreen)priceButton.setAttribute('data-screen',targetNavScreen);var sm=priceButton.querySelector('small');var targetNavLabel=currentRole==='buyer'?(settings.language==='en'?'Search':(settings.language==='kz'?'Іздеу':'Поиск')):(settings.language==='en'?'Price lists':(settings.language==='kz'?'Прайс-парақтар':'Прайсы'));if(sm&&sm.textContent!==targetNavLabel)sm.textContent=targetNavLabel;}
    var adminButton=document.getElementById('adminNavButton'); if(adminButton)adminButton.hidden=!isAdmin;
    var notificationButton=document.getElementById('notificationsButton');if(notificationButton)notificationButton.hidden=(currentRole==='none'&&!isAdmin);
    var markAllButton=document.getElementById('markAllReadButton');if(markAllButton)markAllButton.hidden=(activeScreen!=='notifications'||(currentRole==='none'&&!isAdmin));
    navEl.classList.toggle('admin-nav',!!isAdmin);
    var count=Array.from(navEl.querySelectorAll('button[data-screen]')).filter(function(b){return !b.hidden;}).length;
    var navGrid='repeat('+Math.max(count,1)+',minmax(0,1fr))';
    if(navEl.style.gridTemplateColumns!==navGrid)navEl.style.gridTemplateColumns=navGrid;
    navEl.querySelectorAll('button[data-screen]').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-screen')===activeScreen&&!b.hidden);});
  }
  function applyTheme() {
    var root=document.body; var mode=settings.appearance==='light'?'light':'dark'; settings.appearance=mode;
    // Preserve system-lock-mode and other page state classes while changing colors.
    root.classList.toggle('light',mode==='light');
    ['mono','ocean','forest','rose','amber'].forEach(function(themeName){root.classList.remove('theme-'+themeName);});
    if(settings.theme && settings.theme!=='mono')root.classList.add('theme-'+settings.theme);
    try { var storageKey=appearanceStorageKey(); if(storageKey)localStorage.setItem(storageKey,JSON.stringify({language:settings.language,theme:settings.theme,appearance:mode})); } catch (appearanceWriteError) {}
    var navLabels={ru:['Главная','Прайсы','Подписка','Настройки','Панель'],en:['Home','Price lists','Subscription','Settings','Panel'],kz:['Басты','Прайс-парақтар','Жазылым','Баптаулар','Панель']}; var labels=navLabels[settings.language]||navLabels.ru; var navButtons=document.querySelectorAll('.bottom-nav button[data-screen]');navButtons.forEach(function(b){var i=Number(b.getAttribute('data-nav-index'));var el=b.querySelector('small');if(el&&labels[i])el.textContent=labels[i];}); var nb=document.getElementById('notificationsButton');if(nb)nb.setAttribute('aria-label',settings.language==='en'?'Notifications':(settings.language==='kz'?'Хабарландырулар':'Уведомления')); configureRoleNavigation();
    if(tg){try{tg.setHeaderColor(mode==='light'?'#f3f3f1':'#0c0c0d');tg.setBackgroundColor(mode==='light'?'#f3f3f1':'#0c0c0d');}catch(e){}}
    var preview=document.getElementById('previewBadge');
    var visualKeys=['language','theme','appearance'];
    var dirty=visualKeys.some(function(k){return String(settings[k])!==String(savedSettings[k]);});
    if(preview) preview.classList.toggle('visible',!!dirty);
  }
  function resetPageScroll() {
    try { window.scrollTo(0, 0); } catch (e) {}
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    var shell = document.querySelector('.app-shell');
    if (shell) shell.scrollTop = 0;
    var main = document.getElementById('app');
    if (main) main.scrollTop = 0;
  }
  function nav(screen) { if(currentRole==='buyer'&&screen==='prices')screen='search'; if(activeScreen==='settings'&&screen!=='settings'&&settingsDraftActive){settings=Object.assign({},savedSettings);settingsDraftActive=false;applyTheme();} activeScreen=screen; document.querySelectorAll('.bottom-nav button').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-screen')===screen&&!b.hidden);});configureRoleNavigation(); resetPageScroll(); renderScreen(screen); }
  function load(action, extra, force) { if (!force && cache[action] && Date.now()-cache[action].time<20000) return Promise.resolve(cache[action].data); return api(action,extra).then(function(d){cache[action]={time:Date.now(),data:d};return d;}); }
  function heading(eyebrow,title,subtitle) { return '<p class="eyebrow">'+esc(eyebrow)+'</p><h1 class="page-title">'+esc(title)+'</h1>'+(subtitle?'<p class="subtitle">'+esc(subtitle)+'</p>':''); }
  function profileHero(o) {
    var p=o.profile||{}; var sub=o.subscription; var photo=avatarMarkup(p, 'profile-avatar', 'Аватар пользователя', true);
    var name=[p.first_name,p.last_name].filter(Boolean).join(' ')||'Пользователь Telegram'; var handle=p.username?'@'+p.username:'Telegram ID '+p.tg_id;
    var status=sub&&sub.active?'Подписка активна':'Подписка не активна';
    return '<section class="hero"><div class="hero-row">'+photo+'<div class="profile-identity"><div class="profile-name-marquee"><span class="profile-name-text">'+esc(name)+'</span></div><div class="profile-handle">'+esc(handle)+'</div></div><span class="status-label"><i class="dot" style="background:'+(sub&&sub.active?'var(--good)':'var(--warn)')+'"></i>'+status+'</span></div><div class="hero-bottom"><div><div class="label">Доступ до</div><div class="value" style="font-size:20px">'+(sub&&sub.available_until?esc(fmtDate(sub.available_until)):'—')+'</div></div><button class="button" data-go="subscription">Моя подписка '+iconSvg('arrow')+'</button></div></section>';
  }
  function renderHome() {
    var overviewPromise;
    if (useBootOverviewOnce && overview) { useBootOverviewOnce=false; overviewPromise=Promise.resolve(overview); }
    else overviewPromise=load('overview',{},true);
    return overviewPromise.then(function(o){
      overview=o;profile=o.profile;isAdmin=!!o.is_admin;currentRole=o.role||o.profile.role||(isAdmin?'admin':'seller');currentPriceMultiplier=Number(o.profile.price_multiplier||1);botUsername=o.bot_username||botUsername;
      var unread=document.getElementById('unreadDot');if(unread)unread.classList.toggle('on',Number(o.unread_count)>0);applyTheme();
      var buyer=currentRole==='buyer',seller=currentRole==='seller';
      var html=heading('ЛИЧНЫЙ КАБИНЕТ','Парфюмерный центр',buyer?'Поиск парфюмерии и контроль подписки — в одном месте.':'Прайс-листы, поиск выгодных предложений и контроль подписки — в одном месте.');
      html+=profileHero(o);
      html+='<div class="section-head"><h2>Сводка каталога</h2>'+(buyer?'<button class="text-link" data-go="subscription">Подписка '+iconSvg('arrow')+'</button>':'<button class="text-link" data-go="prices">Все прайсы '+iconSvg('arrow')+'</button>')+'</div>';
      html+='<div class="stats-grid home-catalog-stats '+(buyer?'buyer-stats':'')+'">';
      if(!buyer)html+='<div class="stat-card"><div class="stat-icon">'+iconSvg('file')+'</div><div class="stat-value">'+o.files_count+'</div><div class="stat-label">Прайс-листов</div></div>';
      html+='<div class="stat-card"><div class="stat-icon">'+iconSvg('subscription')+'</div><div class="stat-value">'+Number(o.products_count).toLocaleString(localeTag())+'</div><div class="stat-label">'+(buyer?'Товаров в каталоге':'Позиций каталога')+'</div></div>';
      html+='<div class="stat-card"><div class="stat-icon">'+iconSvg('bell')+'</div><div class="stat-value">'+o.unread_count+'</div><div class="stat-label">Новых уведомлений</div></div><div class="stat-card"><div class="stat-icon">'+iconSvg('clock')+'</div><div class="stat-value">'+(o.subscription&&o.subscription.active?Math.ceil(o.subscription.seconds_left/86400):'—')+'</div><div class="stat-label">Дней осталось</div></div>';
      if(buyer||seller||isAdmin)html+='<button type="button" class="stat-card favorites-stat-card" data-open-favorites><div class="stat-icon">'+favoriteStarSvg(false)+'</div><div class="stat-value" data-favorites-count>'+Number(o.favorites_count||0).toLocaleString(localeTag())+'</div><div class="stat-label">Избранное</div></button>';
      html+='</div>';
      html+='<div class="section-head"><h2>Быстрый доступ</h2></div><div class="action-grid '+(buyer?'buyer-action-grid':'')+'">';
      if(!buyer)html+='<button class="action-card" data-go="prices"><span class="symbol">'+iconSvg('file')+'</span><span><strong>Прайс-листы</strong><small>Файлы и результаты обработки</small></span></button>';
      html+='<button class="action-card '+(buyer?'buyer-search-wide':'')+'" data-go="search"><span class="symbol">'+iconSvg('search')+'</span><span><strong>Поиск товаров</strong><small>Фильтры и цены</small></span></button><button class="action-card" data-go="notifications"><span class="symbol">'+iconSvg('bell')+'</span><span><strong>Уведомления</strong><small>Обновления и статусы</small></span></button><button class="action-card" data-go="support"><span class="symbol">'+iconSvg('arrow')+'</span><span><strong>Поддержка</strong><small>FAQ и связь с разработчиком</small></span></button></div>';
      app.innerHTML=translateHtml(html);configureRoleNavigation();initProfileNameMarquee();var favoritesTrigger=app.querySelector('[data-open-favorites]');if(favoritesTrigger)favoritesTrigger.onclick=openFavoritesModal;return html;
    });
  }
  function initProfileNameMarquee(){
    var box=document.querySelector('.profile-name-marquee'),text=box&&box.querySelector('.profile-name-text');if(!box||!text)return;
    box.classList.remove('is-long');text.style.removeProperty('--marquee-distance');
    requestAnimationFrame(function(){if(text.scrollWidth>box.clientWidth+2){box.classList.add('is-long');text.style.setProperty('--marquee-distance',Math.max(0,text.scrollWidth-box.clientWidth+22)+'px');}});
  }
  function bindSheetDrag(overlay, modal) {
    if(!overlay||!modal)return;var grab=modal.querySelector('.modal-grab');if(!grab||!window.PointerEvent)return;
    var startY=0,delta=0,lastY=0,lastTime=0,velocity=0,dragging=false;
    grab.addEventListener('pointerdown',function(e){if(e.button!==undefined&&e.button!==0)return;dragging=true;startY=lastY=e.clientY;lastTime=e.timeStamp;delta=0;velocity=0;modal.classList.add('is-dragging');try{grab.setPointerCapture(e.pointerId);}catch(err){}});
    grab.addEventListener('pointermove',function(e){if(!dragging)return;delta=Math.max(0,e.clientY-startY);var dt=e.timeStamp-lastTime;if(dt>0)velocity=(e.clientY-lastY)/dt;lastY=e.clientY;lastTime=e.timeStamp;modal.style.transform='translate3d(0,'+delta+'px,0)';});
    function finish(e){if(!dragging)return;dragging=false;modal.classList.remove('is-dragging');var closeNow=delta>72||(velocity>.62&&delta>16);if(closeNow){modal.style.transition='transform '+Math.min(260,Math.max(150,delta*1.1))+'ms cubic-bezier(.18,.72,.22,1)';modal.style.transform='translate3d(0,'+Math.max(window.innerHeight,delta+180)+'px,0)';overlay.classList.add('closing');window.setTimeout(function(){if(overlay.isConnected)overlay.remove();},245);}else{modal.style.transform='';modal.style.transition='';}delta=0;velocity=0;}
    grab.addEventListener('pointerup',finish);grab.addEventListener('pointercancel',finish);
  }
  function openPriceBoostModal() {
    if (currentRole === 'buyer') { toast('Покупателям изменение цены недоступно'); return; }
    if (currentRole === 'seller' && cache.files && Array.isArray(cache.files.data) && cache.files.data.length === 0) return;
    var old=document.getElementById('priceBoostOverlay'); if(old)old.remove();
    var value=Math.round(Math.max(0.1,Math.min(100,Number(currentPriceMultiplier)||1))*10)/10;
    var mode='analog';
    var overlay=document.createElement('div'); overlay.id='priceBoostOverlay'; overlay.className='modal-backdrop';
    overlay.innerHTML='<section class="filter-modal boost-modal" role="dialog" aria-modal="true" aria-labelledby="boostTitle"><div class="modal-grab" aria-label="Потяните, чтобы закрыть"><span></span></div><div class="modal-content"><div class="modal-head"><div><div class="eyebrow">ЦЕНЫ ПРОДАВЦА</div><h2 id="boostTitle">Множитель цены</h2><p class="tiny muted">Базовая цена умножается на выбранное значение в каталоге.</p></div></div><div class="filter-tabs boost-tabs" data-active-tab="filters"><button type="button" class="filter-tab active" data-boost-mode="analog">Аналог</button><button type="button" class="filter-tab" data-boost-mode="keyboard">Клавиатура</button></div><section data-boost-panel="analog"><div class="boost-wheel-shell"><div class="boost-wheel-fade top"></div><div class="boost-wheel" tabindex="0" aria-label="Выбор множителя"></div><div class="boost-wheel-fade bottom"></div><div class="boost-wheel-selection"></div></div></section><section data-boost-panel="keyboard" hidden><div class="boost-adjust-row"><button type="button" class="mini-button" data-boost-delta="0.1">+0.1</button><button type="button" class="mini-button" data-boost-delta="0.5">+0.5</button><button type="button" class="mini-button" data-boost-delta="1">+1</button><button type="button" class="mini-button" data-boost-delta="2.5">+2.5</button><button type="button" class="mini-button" data-boost-delta="10">+10</button></div><input class="input boost-number" data-boost-input type="number" min="0.1" max="100" step="0.1" inputmode="decimal"><div class="boost-adjust-row"><button type="button" class="mini-button" data-boost-delta="-0.1">−0.1</button><button type="button" class="mini-button" data-boost-delta="-0.5">−0.5</button><button type="button" class="mini-button" data-boost-delta="-1">−1</button><button type="button" class="mini-button" data-boost-delta="-2.5">−2.5</button><button type="button" class="mini-button" data-boost-delta="-10">−10</button></div></section><div class="boost-preview card"><span class="tiny muted">Текущий множитель</span><strong data-boost-value></strong><span class="tiny muted">Например, 10 USD → <b data-boost-example></b></span></div></div><div class="modal-actions"><button class="button" data-boost-save>Сохранить буст</button></div></section>';
    document.body.appendChild(overlay);
    var boostModal=overlay.querySelector('.boost-modal');bindSheetDrag(overlay,boostModal);
    var wheel=overlay.querySelector('.boost-wheel'), input=overlay.querySelector('[data-boost-input]');
    // Phone-style picker: 0.10 steps and real empty spacers keep the first/last value in the selection band.
    var vals=[]; for(var n=1;n<=1000;n++)vals.push(n/10);
    var index=vals.reduce(function(best,x,i){return Math.abs(x-value)<Math.abs(vals[best]-value)?i:best;},0);
    var rowHeight=42, inertiaFrame=0, dragState=null, suppressWheelClick=false;
    function fmt(v){return Number(v).toFixed(2);}
    function valueLabel(v){return Number(v).toLocaleString(localeTag(),{minimumFractionDigits:2,maximumFractionDigits:2});}
    function setValue(v,fromWheel){value=Math.round(Math.max(.1,Math.min(100,Number(v)||.1))*10)/10;overlay.querySelector('[data-boost-value]').textContent=valueLabel(value)+'×';overlay.querySelector('[data-boost-example]').textContent=valueLabel(10*value)+' USD';input.value=fmt(value);if(!fromWheel){index=vals.reduce(function(best,x,i){return Math.abs(x-value)<Math.abs(vals[best]-value)?i:best;},0);markWheel();if(wheel.children[index+1])wheel.scrollTo({top:index*rowHeight,behavior:'smooth'});}}
    function markWheel(){var rows=wheel.querySelectorAll('.boost-wheel-row');Array.prototype.forEach.call(rows,function(el,i){var d=Math.abs(i-index);el.classList.toggle('selected',i===index);el.style.opacity=d===0?'1':(d===1?'.54':(d===2?'.28':'.12'));});}
    wheel.innerHTML='<div class="boost-wheel-spacer" aria-hidden="true"></div>'+vals.map(function(v,i){return '<button type="button" class="boost-wheel-row" data-boost-index="'+i+'">'+fmt(v)+'×</button>';}).join('')+'<div class="boost-wheel-spacer" aria-hidden="true"></div>';
    function updateWheelValue(){var next=Math.max(0,Math.min(vals.length-1,Math.round(wheel.scrollTop/rowHeight)));if(next!==index){index=next;value=vals[index];setValue(value,true);markWheel();}}
    function useWheelIndex(next,smooth){index=Math.max(0,Math.min(vals.length-1,next));value=vals[index];setValue(value,true);markWheel();if(smooth)wheel.scrollTo({top:index*rowHeight,behavior:'smooth'});else wheel.scrollTop=index*rowHeight;}
    function snapWheel(){var target=Math.max(0,Math.min(vals.length-1,Math.round(wheel.scrollTop/rowHeight)));useWheelIndex(target,true);}
    function stopWheelInertia(){if(inertiaFrame){cancelAnimationFrame(inertiaFrame);inertiaFrame=0;}}
    function startWheelInertia(velocity){stopWheelInertia();velocity=Math.max(-6,Math.min(6,velocity*1.55));if(Math.abs(velocity)<.12){snapWheel();return;}var previous=0,elapsed=0;function frame(now){if(!previous)previous=now;var dt=Math.min(32,Math.max(1,now-previous));previous=now;elapsed+=dt;wheel.scrollTop+=velocity*dt;wheel.scrollTop=Math.max(0,Math.min(wheel.scrollHeight-wheel.clientHeight,wheel.scrollTop));updateWheelValue();velocity*=Math.pow(.955,dt/16);if(Math.abs(velocity)>.035&&elapsed<2200){inertiaFrame=requestAnimationFrame(frame);}else{inertiaFrame=0;snapWheel();}}inertiaFrame=requestAnimationFrame(frame);}
    wheel.addEventListener('pointerdown',function(e){if(e.pointerType==='mouse'&&e.button!==0)return;stopWheelInertia();dragState={pointerId:e.pointerId,startY:e.clientY,lastY:e.clientY,startScroll:wheel.scrollTop,lastTime:e.timeStamp,velocity:0,moved:false};wheel.classList.add('is-dragging');try{wheel.setPointerCapture(e.pointerId);}catch(err){}});
    wheel.addEventListener('pointermove',function(e){if(!dragState||dragState.pointerId!==e.pointerId)return;var dy=e.clientY-dragState.lastY,dt=Math.max(1,e.timeStamp-dragState.lastTime);if(Math.abs(e.clientY-dragState.startY)>3)dragState.moved=true;if(dragState.moved){e.preventDefault();wheel.scrollTop=dragState.startScroll-(e.clientY-dragState.startY);dragState.velocity=dragState.velocity*.62+(-dy/dt)*.38;updateWheelValue();}dragState.lastY=e.clientY;dragState.lastTime=e.timeStamp;});
    function endWheelDrag(e){if(!dragState||dragState.pointerId!==e.pointerId)return;var state=dragState;dragState=null;wheel.classList.remove('is-dragging');if(state.moved){suppressWheelClick=true;window.setTimeout(function(){suppressWheelClick=false;},0);startWheelInertia(state.velocity);}else snapWheel();}
    wheel.addEventListener('pointerup',endWheelDrag);wheel.addEventListener('pointercancel',endWheelDrag);wheel.addEventListener('lostpointercapture',function(){if(dragState){var state=dragState;dragState=null;wheel.classList.remove('is-dragging');if(state.moved)startWheelInertia(state.velocity);else snapWheel();}});
    wheel.addEventListener('wheel',function(e){e.preventDefault();},{passive:false});
    wheel.addEventListener('click',function(e){if(suppressWheelClick){e.preventDefault();e.stopPropagation();return;}var row=e.target.closest('[data-boost-index]');if(row)useWheelIndex(Number(row.getAttribute('data-boost-index')),true);});
    overlay.querySelectorAll('[data-boost-mode]').forEach(function(b){b.onclick=function(){mode=b.getAttribute('data-boost-mode');overlay.querySelector('.boost-tabs').setAttribute('data-active-tab',mode==='analog'?'filters':'sort');overlay.querySelectorAll('[data-boost-mode]').forEach(function(x){x.classList.toggle('active',x===b);});overlay.querySelectorAll('[data-boost-panel]').forEach(function(panel){panel.hidden=panel.getAttribute('data-boost-panel')!==mode;});if(mode==='keyboard')input.focus();};});
    input.addEventListener('input',function(){if(input.value==='')return;var v=Number(input.value);if(Number.isFinite(v))setValue(v,false);});input.addEventListener('change',function(){setValue(Number(input.value),false);});
    overlay.querySelectorAll('[data-boost-delta]').forEach(function(b){b.onclick=function(){setValue(value+Number(b.getAttribute('data-boost-delta')),false);};});
    function close(){overlay.classList.add('closing');setTimeout(function(){overlay.remove();},220);document.removeEventListener('keydown',keyHandler);}
    function keyHandler(e){if(e.key==='Escape')close();} document.addEventListener('keydown',keyHandler);
    overlay.addEventListener('click',function(e){if(e.target===overlay)close();});
    overlay.querySelector('[data-boost-save]').onclick=function(){var save=overlay.querySelector('[data-boost-save]');save.disabled=true;api('set_price_multiplier',{multiplier:value}).then(function(result){currentPriceMultiplier=Number(result.multiplier||value);if(overview&&overview.profile)overview.profile.price_multiplier=currentPriceMultiplier;delete cache.overview;delete cache.products;delete cache.best_prices;toast('Множитель сохранён: '+Number(currentPriceMultiplier).toLocaleString(localeTag(),{minimumFractionDigits:2,maximumFractionDigits:2})+'×');close();if(activeScreen==='prices')renderScreen('prices');else if(activeScreen==='search')renderScreen('search');}).catch(function(e){save.disabled=false;toast(friendlyError(e));});};
    setValue(value,false);setTimeout(function(){overlay.classList.add('is-open');},10);
  }
  function renderPrices() {
    if(currentRole==='buyer'){nav('search');return Promise.resolve();}
    return Promise.all([load('files',{},true),load('overview',{})]).then(function(all){var files=all[0],o=all[1];currentRole=o.role||o.profile.role||currentRole;if(currentRole==='buyer'){nav('search');return;}currentPriceMultiplier=Number(o.profile.price_multiplier||1);var html=heading('РАБОТА С ДАННЫМИ','Прайс-листы','Бот принимает Excel и CSV, распознаёт строки и собирает товары в единый каталог.');
      html+='<div class="card"><div class="row"><div><div class="card-title">Добавить новый прайс</div><div class="tiny muted">Отправьте документ боту в Telegram. После обработки данные появятся здесь.</div></div><div class="file-icon excel-file-icon">'+excelIconSvg()+'</div></div><div class="divider"></div><a class="button full telegram-link" id="openBot" href="'+esc(botUrl('webapp') || '#')+'" target="_blank" rel="noopener noreferrer">Открыть чат с ботом '+iconSvg('arrow')+'</a></div>';
      html+='<div class="section-head"><h2>Ваши файлы</h2><span class="status-label section-count">Всего: '+files.length+'</span></div>';
      if(!files.length)html+='<div class="empty"><div class="symbol">'+iconSvg('file')+'</div><strong>Каталог пока пуст</strong><p class="tiny">Добавьте первый прайс-лист через Telegram-бота.</p><a class="button secondary telegram-link" id="openBotEmpty" href="'+esc(botUrl('webapp') || '#')+'" target="_blank" rel="noopener noreferrer">Перейти к боту</a></div>';
      else {var readyFiles=files.filter(function(f){return f.status==='ready';});html+='<div class="file-list">';files.forEach(function(f){var ready=f.status==='ready';var reviewCount=Number(f.review_count||0);var reviewLabel=reviewCount?(settings.language==='en'?' · Possibly '+reviewCount+' inaccuracies':(settings.language==='kz'?' · '+reviewCount+' ықтимал дәлсіздік':' · Возможно '+reviewCount+' неточностей')):'';html+='<article class="file-card"><div class="file-icon excel-file-icon">'+excelIconSvg()+'</div><div class="file-info"><div class="file-name">'+esc(f.filename)+'</div><div class="file-meta">'+fmtSize(f.size_bytes)+' · '+Number(f.product_count||0)+' товаров · '+esc(fmtDate(f.imported_at))+'</div><div class="file-meta">'+(ready?iconSvg('check')+' '+esc(translateHtml('Обработан')):esc(fileStatusLabel(f.status)))+reviewLabel+'</div></div><div class="file-actions">'+(ready?'<a class="mini-button telegram-link" href="'+esc(botUrl('download_'+f.id) || '#')+'" target="_blank" rel="noopener noreferrer" data-download-file="'+f.id+'">Скачать</a>':'')+'<button class="mini-button" data-delete-file="'+f.id+'">Удалить</button></div></article>';});html+='</div>';if(readyFiles.length>0)html+='<div class="download-all-wrap"><a class="button full telegram-link" id="downloadAllFiles" data-download-all href="'+esc(botUrl('download_all')||'#')+'">Скачать все ('+readyFiles.length+')</a></div>'; }
      var boostDisabled=currentRole==='seller'&&!files.length;
      html+='<div class="section-head"><h2>Инструменты каталога</h2></div><div class="action-grid"><button class="action-card" data-go="search"><span class="symbol">'+iconSvg('search')+'</span><span><strong>Поиск и фильтры</strong><small>Бренд, тип, цена и объём</small></span></button>'+((currentRole==='seller'||currentRole==='admin')?'<button class="action-card '+(boostDisabled?'is-disabled':'')+'" id="openPriceBoost" '+(boostDisabled?'disabled aria-disabled="true"':'')+'><span class="symbol">'+iconSvg('subscription')+'</span><span><strong>Буст цены</strong><small>'+(boostDisabled?'Добавьте прайс-лист, чтобы включить буст':'Множитель: '+currentPriceMultiplier.toFixed(2)+'×')+'</small></span></button>':'')+'</div>';
      app.innerHTML=translateHtml(html); bindFileButtons(); bindOpenBot();var boost=document.getElementById('openPriceBoost');if(boost&&!boost.disabled)boost.onclick=openPriceBoostModal;configureRoleNavigation(); return html;});
  }
  function botUrl(payload) {
    var username = String(botUsername || '').replace(/^@/, '').trim();
    if (!username || username === 'YOUR_BOT_USERNAME') return '';
    return 'https://t.me/' + encodeURIComponent(username) + (payload ? '?start=' + encodeURIComponent(payload) : '');
  }
  function openTelegramUrl(url) {
    url = String(url || '');
    if (!/^https:\/\/t\.me\//i.test(url) && !/^https:\/\//i.test(url)) return false;
    if (tg) {
      try { if (typeof tg.openTelegramLink === 'function' && /^https:\/\/t\.me\//i.test(url)) { tg.openTelegramLink(url); return true; } } catch (e) {}
      try { if (typeof tg.openLink === 'function') { tg.openLink(url); return true; } } catch (e) {}
    }
    // window.open is invoked synchronously from the user's click, so browsers are less likely to block it.
    try { var opened = window.open(url, '_blank'); if (opened) { try { opened.opener = null; } catch (e) {} return true; } } catch (e) {}
    try { window.location.href = url; return true; } catch (e) {}
    return false;
  }
  function openBotLink(payload) {
    var u = (botUsername || '').replace(/^@/, '').trim();
    if (!u || u === 'YOUR_BOT_USERNAME') { toast('Укажите BOT_USERNAME в конфигурации сайта.'); return; }
    var url = 'https://t.me/' + encodeURIComponent(u) + (payload ? '?start=' + encodeURIComponent(payload) : '');
    if (!openTelegramUrl(url)) toast('Не удалось открыть Telegram. Попробуйте открыть ссылку из меню приложения.');
  }
  function openBotChat() { openBotLink('webapp'); }
  function openSubscriptionChat() { openBotLink('subscribe'); }
  function bindOpenBot(){['openBot','openBotEmpty'].forEach(function(id){var b=document.getElementById(id);if(b&&b.getAttribute('href')==='#')b.onclick=function(event){event.preventDefault();openBotChat();};});}
  function bindFileButtons(){
    document.querySelectorAll('[data-download-all]').forEach(function(link){
      link.onclick=function(event){event.preventDefault();openBotLink('download_all');};
    });
    document.querySelectorAll('[data-download-file]').forEach(function(link){
      if(link.getAttribute('href')==='#') link.onclick=function(event){
        event.preventDefault();
        var id=Number(link.getAttribute('data-download-file'));
        if(Number.isInteger(id)&&id>0) openBotLink('download_'+id);
      };
    });
    document.querySelectorAll('[data-delete-file]').forEach(function(b){
      b.onclick=function(){
        if(!confirm(translateHtml('Удалить прайс-лист из каталога?'))) return;
        var id=Number(b.getAttribute('data-delete-file'));
        api('delete_file',{file_id:id}).then(function(){delete cache.files;delete cache.overview;toast('Прайс-лист удалён');renderPrices();}).catch(function(e){toast(e);});
      };
    });
  }
  function renderSubscription(){return load('overview',{},true).then(function(o){
    var s=o.subscription||null;var secondsLeft=Number(s&&s.seconds_left||0);
    if((!isFinite(secondsLeft)||secondsLeft<=0)&&s&&s.available_until){var untilTs=Date.parse(String(s.available_until).replace(' ','T'));if(isFinite(untilTs))secondsLeft=Math.max(0,Math.floor((untilTs-Date.now())/1000));}
    var subActive=!!(s&&(s.active===true||Number(s.active)===1))&&secondsLeft>0;
    var days=subActive?Math.ceil(secondsLeft/86400):0;
    var activatedTs=s&&s.activated_at?Date.parse(String(s.activated_at).replace(' ','T')):NaN;var expiresTs=s&&s.available_until?Date.parse(String(s.available_until).replace(' ','T')):NaN;var measuredDuration=isFinite(activatedTs)&&isFinite(expiresTs)&&expiresTs>activatedTs?Math.floor((expiresTs-activatedTs)/1000):0;var durationSeconds=Math.max(1,measuredDuration||Number(s&&s.duration_seconds)||Number(s&&s.duration_days)*86400||secondsLeft||86400);
    var percent=subActive?Math.max(0,Math.min(100,secondsLeft/durationSeconds*100)):0;
    var html=heading('ДОСТУП И ТАРИФ','Ваша подписка','Управляйте сроком доступа и получайте напоминания до окончания подписки.');
    var subKeyDisplay=s&&s.key_prefix?(String(s.key_prefix).toUpperCase().indexOf('DEMO-')===0?'DEMO– · – ···· – ····':(String(s.key_prefix).toUpperCase().indexOf('BP-')===0?'BP– ···· – ···· – ···· – ····':String(s.key_prefix).replace(/-/g,'–')+' – ····')):'не активирован';
    html+='<section class="subscription-card"><div class="row"><span class="subscription-plan">BASALT · PREMIUM ACCESS</span><span class="status-label">'+(subActive?'Активна':'Не активна')+'</span></div><div class="subscription-status"><span class="status-dot"></span> '+(subActive?'Все функции доступны':'Требуется активация')+'</div><div class="subscription-time">'+(subActive?days+' '+(days===1?'день':(days>1&&days<5?'дня':'дней')):'Нет доступа')+'</div><div class="muted tiny">'+(s&&s.available_until?'Действует до '+fmtDate(s.available_until):'Активируйте ключ в Telegram-боте, чтобы начать работу.')+'</div><div class="progress" aria-label="Осталось '+percent.toFixed(0)+' процентов подписки"><span style="width:'+percent.toFixed(2)+'% !important;--subscription-progress:'+percent.toFixed(2)+'%;background:#fff;display:block;min-width:'+(subActive&&percent>0?'2px':'0')+'"></span></div><div class="row tiny muted"><span>Ключ: '+esc(subKeyDisplay)+'</span><span>'+(subActive?'Доступ открыт':'Ожидает активации')+'</span></div></section>';
    html+='<div class="section-head"><h2>Что включено</h2></div><div class="card"><div class="setting-row"><div class="setting-icon">'+iconSvg('file')+'</div><div class="setting-copy"><strong>Неограниченный каталог прайс-листов</strong><small>Обработка файлов и единый список товаров</small></div><span class="feature-check">'+iconSvg('check')+'</span></div><div class="divider"></div><div class="setting-row"><div class="setting-icon">'+iconSvg('search')+'</div><div class="setting-copy"><strong>Поиск и сравнение цен</strong><small>Фильтры по бренду, типу и объёму</small></div><span class="feature-check">'+iconSvg('check')+'</span></div><div class="divider"></div><div class="setting-row"><div class="setting-icon">'+iconSvg('bell')+'</div><div class="setting-copy"><strong>Уведомления о сроке</strong><small>За 72 часа, затем каждые 24 часа до окончания</small></div><span class="feature-check">'+iconSvg('check')+'</span></div></div>';
    html+='<div class="card"><div class="card-title">Продлить доступ</div><p class="tiny muted">Ключ активации вводится в чате с ботом. Новый ключ активирует или продлевает доступ согласно настройкам подписки.</p><a class="button full telegram-link" id="renewButton" href="'+esc(botUrl('subscribe')||'#')+'" target="_blank" rel="noopener noreferrer">Перейти к активации в Telegram '+iconSvg('arrow')+'</a></div>';app.innerHTML=translateHtml(html);return html;
  });}
  function renderSettings(){var settingsPromise=settingsDraftActive?Promise.resolve(settings):load('settings',{},false);return settingsPromise.then(function(s){if(!settingsDraftActive){settings=Object.assign({},s||settings);if(settings.appearance!=='dark'&&settings.appearance!=='light')settings.appearance='dark';savedSettings=Object.assign({},settings);}else{settings=Object.assign({},settings);}applyTheme();var html=heading('ПЕРСОНАЛИЗАЦИЯ','Настройки','Подстройте приложение под себя — от внешнего вида до уведомлений.');
    var pp=overview&&overview.profile?overview.profile:{}; var ppAvatar=avatarMarkup(pp, 'profile-settings-avatar', 'Аватар пользователя', false); html+='<div class="card profile-settings-card"><div><div class="card-title">Профиль Telegram</div><div class="tiny muted">'+esc(pp.username?'@'+pp.username:'Без username')+' · Telegram ID '+esc(pp.tg_id||'—')+'</div><div style="margin-top:9px"><span class="role-badge '+(currentRole==='admin'?'admin':(currentRole==='buyer'?'buyer':(currentRole==='none'?'none':'user')))+'">'+(currentRole==='admin'?'ADMIN':(currentRole==='buyer'?'ПОКУПАТЕЛЬ':(currentRole==='none'?'БЕЗ РОЛИ':'ПРОДАВЕЦ')))+'</span></div></div>'+ppAvatar+'</div>';
    html+='<div class="card"><div class="card-title">Язык интерфейса</div><div class="setting-row"><div class="setting-icon">'+iconSvg('globe')+'</div><div class="setting-copy"><strong>Язык</strong><small>Выберите язык приложения</small></div>'+customDropdown('languageSelect','language',[{value:'ru',label:'__BP_FIXED_RUSSIAN__'},{value:'en',label:'English'},{value:'kz',label:'Қазақша'}],settings.language)+'</div><div class="divider"></div><div class="row"><div><div class="card-title">Цветовая тема</div><div class="tiny muted">Монохромная по умолчанию</div></div></div><div class="theme-grid">'+themeChoice('mono','Mono','#f2f2f2','#141414')+themeChoice('ocean','Ocean','#9cd5f3','#16354a')+themeChoice('forest','Forest','#a8d6ae','#1c3b25')+themeChoice('rose','Rose','#efbdcb','#4a202d')+themeChoice('amber','Amber','#e9cf91','#4a3611')+'</div><div class="divider"></div><div class="setting-row"><div class="setting-icon">'+iconSvg('settings')+'</div><div class="setting-copy"><strong>Режим отображения</strong><small>Можно переключить любую тему на светлую или тёмную</small></div>'+customDropdown('appearanceSelect','appearance',[{value:'dark',label:'Тёмный'},{value:'light',label:'Светлый'}],settings.appearance)+'</div></div>';
    if(currentRole==='seller'||currentRole==='admin'){html+='<div class="section-head"><h2>Приватность продавца</h2></div><div class="card seller-privacy-settings">'+toggleRow('seller_products_public','Общедоступность товаров','Если выключено, товары скрыты от покупателей и обозначаются анонимно.','lock')+'<div class="divider"></div>'+toggleRow('seller_dm_enabled','Доступность личных сообщений','Разрешить покупателям связываться с вами и отправлять списки избранного.','telegram')+'</div>'; }
    html+='<div class="section-head"><h2>Уведомления</h2></div><div class="card">'+toggleRow('notify_updates','Обновления приложения','Новости, новые возможности и изменения','code')+(currentRole==='buyer'?'':'<div class="divider"></div>'+toggleRow('notify_processed_files','Обработанные файлы','Результат загрузки и ошибки распознавания','file'))+'<div class="divider"></div>'+toggleRow('notify_subscription','Подписка','Напоминания за 72 часа и далее каждые 24 часа','subscription')+'</div>';
    html+='<button class="button full" id="saveSettings">Сохранить настройки</button><div style="height:12px"></div><button class="button secondary full" data-go="notifications">Открыть центр уведомлений '+iconSvg('arrow')+'</button>'; 
    app.innerHTML=translateHtml(html);bindSettings();return html;});}
  function customDropdown(id,key,options,current){var selected=options.filter(function(o){return o.value===current;})[0]||options[0];return '<div class="custom-select" id="'+id+'" data-selected-value="'+esc(selected.value)+'" data-select-key="'+key+'"><button type="button" class="custom-select-trigger" aria-haspopup="listbox" aria-expanded="false"><span>'+esc(selected.label)+'</span>'+iconSvg('chevron')+'</button><div class="custom-select-menu" role="listbox">'+options.map(function(o){return '<button type="button" role="option" aria-selected="'+(o.value===current?'true':'false')+'" data-value="'+esc(o.value)+'" data-label="'+esc(o.label)+'" class="custom-select-option '+(o.value===current?'selected':'')+'">'+esc(o.label)+(o.value===current?iconSvg('check'):'')+'</button>';}).join('')+'</div></div>'; }
  function themeChoice(key,label,a,b){return '<button class="theme-choice '+(settings.theme===key?'active':'')+'" data-theme="'+key+'"><span class="swatch"><i style="background:'+a+'"></i><i style="background:'+b+'"></i></span>'+label+'</button>';}
  function toggleRow(key,title,sub,symbol){return '<div class="setting-row"><div class="setting-icon">'+iconSvg(symbol)+'</div><div class="setting-copy"><strong>'+title+'</strong><small>'+sub+'</small></div><button class="toggle '+(Number(settings[key])?'on':'')+'" data-toggle="'+key+'" aria-pressed="'+(Number(settings[key])?'true':'false')+'"></button></div>';}
  function bindSettings(){
    document.querySelectorAll('[data-theme]').forEach(function(b){b.onclick=function(){settingsDraftActive=true;settings.theme=b.getAttribute('data-theme');document.querySelectorAll('[data-theme]').forEach(function(x){x.classList.toggle('active',x===b);});applyTheme();};});
    document.querySelectorAll('[data-toggle]').forEach(function(b){b.onclick=function(){settingsDraftActive=true;var k=b.getAttribute('data-toggle');settings[k]=Number(!Number(settings[k]));b.classList.toggle('on',!!settings[k]);b.setAttribute('aria-pressed',settings[k]?'true':'false');applyTheme();};});
    document.querySelectorAll('[data-select-key]').forEach(function(drop){var trigger=drop.querySelector('.custom-select-trigger');trigger.onclick=function(e){e.stopPropagation();var open=drop.classList.contains('open');document.querySelectorAll('[data-select-key]').forEach(function(other){other.classList.remove('open');other.querySelector('.custom-select-trigger').setAttribute('aria-expanded','false');});drop.classList.toggle('open',!open);trigger.setAttribute('aria-expanded',!open?'true':'false');};drop.querySelectorAll('[data-value]').forEach(function(option){option.onclick=function(){var key=drop.getAttribute('data-select-key');var value=option.getAttribute('data-value');settingsDraftActive=true;settings[key]=value;drop.setAttribute('data-selected-value',value);trigger.querySelector('span').textContent=option.getAttribute('data-label');drop.querySelectorAll('[data-value]').forEach(function(other){other.classList.toggle('selected',other===option);other.setAttribute('aria-selected',other===option?'true':'false');var check=other.querySelector('.svg-icon');if(check)check.remove();if(other===option)other.insertAdjacentHTML('beforeend',iconSvg('check'));});drop.classList.remove('open');trigger.setAttribute('aria-expanded','false');applyTheme();if(key==='language'){renderSettings();return;}};});});
    document.getElementById('saveSettings').onclick=function(){api('save_settings',settings).then(function(){savedSettings=Object.assign({},settings);settingsDraftActive=false;cache.settings={time:Date.now(),data:Object.assign({},settings)};toast('Настройки сохранены');applyTheme();renderScreen(activeScreen);}).catch(function(e){toast(e);});};
  }
  function renderNotifications(){return load('notifications',{},true).then(function(rows){var html=heading('ЦЕНТР СОБЫТИЙ','Уведомления','Важное о прайс-листах, подписке и обновлениях.');if(!rows.length)html+='<div class="empty"><div class="symbol">'+iconSvg('bell')+'</div><strong>Пока тихо</strong><p class="tiny">Новые события появятся здесь.</p></div>';else{html+='<div class="card notification-list">';rows.forEach(function(n,i){var icon=n.kind==='subscription'?iconSvg('subscription'):(n.kind==='file_processed'?iconSvg('file'):(n.kind==='update'?iconSvg('megaphone'):iconSvg('bell')));var id=String(n.id);var open=expandedNotificationId===id;html+='<article class="notification-accordion '+(!Number(n.is_read)?'unread ':'')+(open?'open':'')+'" data-notification="'+esc(id)+'"><button class="notification-heading" type="button" aria-expanded="'+(open?'true':'false')+'"><span class="notification-icon">'+icon+'</span><span class="notification-title-wrap"><strong>'+esc(n.title)+'</strong></span><i class="notification-unread-dot" aria-label="Не прочитано"></i><span class="notification-chevron">'+iconSvg('chevron')+'</span></button><div class="notification-details"><div class="notification-details-inner"><p>'+esc(n.body||'')+'</p><time class=\"notification-detail-time\">'+esc(fmtDate(n.created_at))+'</time></div></div></article>';});html+='</div>';}
    app.innerHTML=translateHtml(html);var markAll=document.getElementById('markAllReadButton');if(markAll){var hasUnread=rows.some(function(n){return !Number(n.is_read);});markAll.disabled=!hasUnread;markAll.hidden=(activeScreen!=='notifications'||(currentRole==='none'&&!isAdmin));markAll.setAttribute('aria-label',hasUnread?'Прочитать все уведомления':'Все уведомления прочитаны');}document.querySelectorAll('[data-notification]').forEach(function(item){var button=item.querySelector('.notification-heading');button.onclick=function(){var id=String(item.getAttribute('data-notification'));var wasOpen=item.classList.contains('open');document.querySelectorAll('[data-notification]').forEach(function(other){other.classList.remove('open');other.querySelector('.notification-heading').setAttribute('aria-expanded','false');});if(!wasOpen){item.classList.add('open');button.setAttribute('aria-expanded','true');expandedNotificationId=id;var row=rows.filter(function(x){return String(x.id)===id;})[0];if(row&&!Number(row.is_read)){api('mark_read',{id:Number(id)}).then(function(){row.is_read=1;item.classList.remove('unread');var dot=item.querySelector('.notification-unread-dot');if(dot)dot.remove();delete cache.notifications;delete cache.overview;var globalDot=document.getElementById('unreadDot');if(globalDot)globalDot.classList.toggle('on',rows.some(function(x){return !Number(x.is_read);}));if(markAll){var remain=rows.some(function(x){return !Number(x.is_read);});markAll.disabled=!remain;markAll.setAttribute('aria-label',remain?'Прочитать все уведомления':'Все уведомления прочитаны');}}).catch(function(e){toast(e);});}}else{expandedNotificationId=null;}};});return html;});}
  function activeFilterCount(f) { return Object.keys(f).filter(function(k){if(Array.isArray(f[k]))return f[k].length>0;return f[k]!==''&&f[k]!==null&&f[k]!==undefined;}).length; }
  function selectOptions(name, values, selected, labeler) {
    var html='<option value="">Все</option>';
    (values||[]).forEach(function(v){var val=typeof v==='object'?v.value:v;var label=labeler?labeler(v):(typeof v==='object'?v.label:v);html+='<option value="'+esc(val)+'" '+(String(selected)===String(val)?'selected':'')+'>'+esc(label)+'</option>';});
    return '<label class="filter-field"><span>'+esc(name)+'</span><select class="input" data-filter-field="'+esc(name)+'">'+html+'</select></label>';
  }
  function openFilterModal(filters, currentSort, onApply) {
    api('filter_options').then(function (opts) {
      var old = document.getElementById('filterOverlay');
      if (old) old.remove();
      var overlay = document.createElement('div');
      overlay.id = 'filterOverlay';
      overlay.className = 'modal-backdrop';

      function optionList(items, valueKey, labelKey) {
        return (items || []).map(function (x) {
          return { value: x[valueKey] === undefined ? x : x[valueKey], label: x[labelKey] === undefined ? x : x[labelKey] };
        });
      }
      var brands = optionList(opts.brands || []);
      var volumes = (opts.volumes || []).map(function (v) { return { value: String(v), label: String(Number(v)) + ' ml' }; });
      var sizes = (opts.sizes || []).map(function (item) { return { value:String(item.value||''), label:String(item.label||'Размер не указан') }; });
      function isDisplayType(code){return ['SHOWCARD','BILLBOARD'].indexOf(String(code||'').toUpperCase())!==-1;}
      function localizedMeasureLabel(display){return settings.language==='en'?(display?'Size':'Volume'):(settings.language==='kz'?(display?'Өлшем':'Көлем'):(display?'Размер':'Объём'));}
      function localizedAllLabel(){return settings.language==='en'?'All':(settings.language==='kz'?'Барлығы':'Все');}
      function selectedTypeInModal(){var typeDrop=overlay.querySelector('[data-filter-select-key="type"]');return typeDrop?typeDrop.getAttribute('data-selected-value')||'':'';}
      function currentMeasureOptions(display){return display?sizes:volumes;}
      var typeLabels = {
        ACCESSORY:'Аксессуар', AFTERSHAVE:'Лосьон после бритья', BODY_LOTION:'Лосьон для тела', BODY_WASH:'Средство для мытья тела',
        CONDITIONER:'Кондиционер', CREAM:'Крем', DEODORANT:'Дезодорант', DISPLAY:'Дисплей', SHOWCARD:'Шоукард', BILLBOARD:'Билборд', EDC:'EDC | Одеколон', EDP:'EDP | Парфюмерная вода',
        EDS:'EDS | Парфюмированный спрей', EDT:'EDT | Туалетная вода', EXTRAIT:'Экстракт духов', HAIR_MASK:'Маска для волос',
        HAIR_MIST:'Мист для волос', HAIR_OIL:'Масло для волос', HAIR_STYLING:'Средство для укладки волос', HAIR_TREATMENT:'Средство для ухода за волосами',
        LIP_GLOSS:'Блеск для губ', LIPSTICK:'Помада', PARFUM:'Духи', SHAMPOO:'Шампунь', SHOWER_GEL:'Гель для душа', SKINCARE:'Уход за кожей'
      };
      var typeLabelsEn = {ACCESSORY:'Accessory',AFTERSHAVE:'Aftershave lotion',BODY_LOTION:'Body lotion',BODY_WASH:'Body wash',CONDITIONER:'Conditioner',CREAM:'Cream',DEODORANT:'Deodorant',DISPLAY:'Display',SHOWCARD:'Showcard',BILLBOARD:'Billboard',EDC:'EDC | Eau de Cologne',EDP:'EDP | Eau de Parfum',EDS:'EDS | Perfumed spray',EDT:'EDT | Eau de Toilette',EXTRAIT:'Perfume extract',HAIR_MASK:'Hair mask',HAIR_MIST:'Hair mist',HAIR_OIL:'Hair oil',HAIR_STYLING:'Hair styling',HAIR_TREATMENT:'Hair treatment',LIP_GLOSS:'Lip gloss',LIPSTICK:'Lipstick',PARFUM:'Parfum',SHAMPOO:'Shampoo',SHOWER_GEL:'Shower gel',SKINCARE:'Skincare'};
      var typeLabelsKz = {ACCESSORY:'Керек-жарақ',AFTERSHAVE:'Қырынудан кейінгі лосьон',BODY_LOTION:'Дене лосьоны',BODY_WASH:'Денеге арналған жуу құралы',CONDITIONER:'Кондиционер',CREAM:'Крем',DEODORANT:'Дезодорант',DISPLAY:'Дисплей',SHOWCARD:'Шоукард',BILLBOARD:'Билборд',EDC:'EDC | Одеколон',EDP:'EDP | Парфюмерлік су',EDS:'EDS | Хош иісті спрей',EDT:'EDT | Дәретхана суы',EXTRAIT:'Парфюм экстракты',HAIR_MASK:'Шашқа арналған маска',HAIR_MIST:'Шашқа арналған мист',HAIR_OIL:'Шаш майы',HAIR_STYLING:'Шаш сәндеу құралы',HAIR_TREATMENT:'Шаш күтімі құралы',LIP_GLOSS:'Ерін жылтыры',LIPSTICK:'Ерін далабы',PARFUM:'Парфюм',SHAMPOO:'Сусабын',SHOWER_GEL:'Душ гелі',SKINCARE:'Тері күтімі'};
      function localizedType(code) { var map=settings.language==='en'?typeLabelsEn:(settings.language==='kz'?typeLabelsKz:typeLabels); return map[String(code||'').toUpperCase()] || String(code||''); }
      var types = optionList(opts.types || []).map(function (item) { return {value:item.value,label:localizedType(item.value)}; });
      var files = optionList(opts.files || [], 'id', 'filename');
      var publicCatalogFallback=!!opts.public_catalog_fallback;
      var buyerFilters = currentRole === 'buyer' || publicCatalogFallback;
      var sellerFilterEnabled = buyerFilters || currentRole === 'admin' || isAdmin;
      var selectedSellerIds = Array.isArray(filters.seller_ids) ? filters.seller_ids.map(Number).filter(function(v){return v>0;}) : [];
      var genders = (opts.genders || []).map(function (g) { return { value: g, label: g === 'M' ? 'Мужской' : (g === 'F' ? 'Женский' : 'Унисекс') }; });
      var categoryLabels = {body:'Для тела',hair:'Для волос',makeup:'Макияж',other:'Другое',perfume:'Парфюмерия',cosmetics:'Косметика'};
      var categoryLabelsEn = {body:'Body',hair:'Hair',makeup:'Makeup',other:'Other',perfume:'Perfume',cosmetics:'Cosmetics'};
      var categoryLabelsKz = {body:'Дене',hair:'Шаш',makeup:'Макияж',other:'Басқа',perfume:'Парфюмерия',cosmetics:'Косметика'};
      var categories = (opts.categories || []).map(function (c) { var map=settings.language==='en'?categoryLabelsEn:(settings.language==='kz'?categoryLabelsKz:categoryLabels); return { value: c, label: map[String(c).toLowerCase()] || c }; });
      var rawMin = opts.min_price == null || opts.min_price === '' ? NaN : Number(opts.min_price);
      var rawMax = opts.max_price == null || opts.max_price === '' ? NaN : Number(opts.max_price);
      var domainMin = Number.isFinite(rawMin) ? Math.floor(rawMin * 100) / 100 : 0;
      var domainMax = Number.isFinite(rawMax) ? Math.ceil(rawMax * 100) / 100 : 100;
      if (domainMax <= domainMin) domainMax = domainMin + 1;
      var step = '0.01';
      var sliderMinValue = filters.min_price !== '' && filters.min_price != null ? Number(filters.min_price) : domainMin;
      var sliderMaxValue = filters.max_price !== '' && filters.max_price != null ? Number(filters.max_price) : domainMax;
      if (!Number.isFinite(sliderMinValue)) sliderMinValue = domainMin;
      if (!Number.isFinite(sliderMaxValue)) sliderMaxValue = domainMax;
      sliderMinValue = Math.max(domainMin, Math.min(domainMax, sliderMinValue));
      sliderMaxValue = Math.max(domainMin, Math.min(domainMax, sliderMaxValue));
      if (sliderMinValue > sliderMaxValue) { var swapValue = sliderMinValue; sliderMinValue = sliderMaxValue; sliderMaxValue = swapValue; }
      var selectedSort = currentSort || 'price_asc';
      var priceMode = 'slider';

      function filterDropdown(label, key, items) {
        var all = [{ value: '', label: localizedAllLabel() }].concat(items || []);
        var current = filters[key] == null ? '' : String(filters[key]);
        var selected = all.filter(function (item) { return String(item.value) === current; })[0] || all[0];
        var optionHtml = all.map(function (item) {
          var value = String(item.value == null ? '' : item.value);
          var active = value === String(selected.value == null ? '' : selected.value);
          return '<button type="button" role="option" aria-selected="' + (active ? 'true' : 'false') + '" data-filter-value="' + esc(value) + '" data-filter-label="' + esc(item.label) + '" class="custom-select-option' + (active ? ' selected' : '') + '">' + esc(item.label) + (active ? iconSvg('check') : '') + '</button>';
        }).join('');
        return '<div class="filter-field"><span>' + esc(label) + '</span><div class="custom-select filter-custom-select" data-filter-select-key="' + esc(key) + '" data-selected-value="' + esc(String(selected.value == null ? '' : selected.value)) + '"><button type="button" class="custom-select-trigger" aria-haspopup="listbox" aria-expanded="false"><span>' + esc(selected.label) + '</span>' + iconSvg('chevron') + '</button><div class="custom-select-menu" role="listbox">' + optionHtml + '</div></div></div>';
      }
      function priceText(value) {
        return Number(value).toLocaleString(localeTag(), {minimumFractionDigits: 0, maximumFractionDigits: 2}) + ' USD';
      }
      var sortOptions = [
        {value:'price_asc', label:'Сначала дешевле'},
        {value:'price_desc', label:'Сначала дороже'},
        {value:'name', label:'А–Я'},
        {value:'name_desc', label:'Я–А'},
        {value:'volume', label:localizedMeasureLabel(isDisplayType(filters.type))},
        {value:'newest', label:'Сначала новые'},
        {value:'oldest', label:'Сначала старые'}
      ];
      function sortMarkup() {
        return sortOptions.map(function(item) {
          var active = item.value === selectedSort;
          return '<button type="button" class="sort-option' + (active ? ' active' : '') + '" data-sort-value="' + item.value + '" aria-pressed="' + (active ? 'true' : 'false') + '"><span>' + esc(item.label) + '</span>' + (active ? iconSvg('check') : '') + '</button>';
        }).join('');
      }
      var sellerFilterMarkup = '';
      if (sellerFilterEnabled) {
        var sellerItems = opts.sellers || [];
        var sellerRows = sellerItems.map(function(seller){var privateRow=!!Number(seller.is_private)&&!isAdmin;if(privateRow){return '<div role="option" aria-disabled="true" class="custom-select-option seller-filter-option seller-filter-private" tabindex="-1"><span class="seller-filter-lock">'+iconSvg('lock')+'</span><span class="seller-filter-name">'+esc(seller.full_name||'Продавец')+'</span><small class="seller-product-count seller-product-count-hidden">Товары скрыты</small></div>';}var id=Number(seller.tg_id);var label=seller.full_name||('Продавец');var checked=selectedSellerIds.indexOf(id)!==-1;var countVisible=Number(seller.is_public)===1&&seller.product_count!=null;return '<button type="button" role="option" class="custom-select-option seller-filter-option '+(checked?'selected':'')+'" data-seller-filter-id="'+id+'" aria-selected="'+(checked?'true':'false')+'" aria-pressed="'+(checked?'true':'false')+'"><span class="seller-filter-checkbox">'+(checked?'<i class="seller-filter-dot"></i>':'')+'</span><span class="seller-filter-name">'+esc(label)+'</span>'+(countVisible?'<small class="seller-product-count">(Товаров: '+Number(seller.product_count)+')</small>':'<small class="seller-product-count seller-product-count-hidden">Товары скрыты</small>')+'</button>';}).join('');
        var sellerSummary = selectedSellerIds.length===0 ? 'Все продавцы' : (selectedSellerIds.length===1 ? (function(){var found=sellerItems.filter(function(s){return Number(s.tg_id)===selectedSellerIds[0];})[0];return found?(found.full_name||'Продавец'):'Выбран 1 продавец';})() : 'Выбрано продавцов: '+selectedSellerIds.length);
        var sellerAllOption = '<button type="button" role="option" class="custom-select-option seller-filter-option seller-filter-all '+(selectedSellerIds.length?'':'selected')+'" data-seller-filter-all aria-selected="'+(selectedSellerIds.length?'false':'true')+'" aria-pressed="'+(selectedSellerIds.length?'false':'true')+'"><span class="seller-filter-checkbox">'+(selectedSellerIds.length?'':'<i class="seller-filter-dot"></i>')+'</span><span>Все продавцы</span></button>';
        sellerFilterMarkup='<div class="filter-field seller-filter-block"><span>Продавцы</span><div class="custom-select filter-custom-select seller-custom-select" data-seller-select><button type="button" class="custom-select-trigger" aria-haspopup="listbox" aria-expanded="false"><span data-seller-filter-summary>'+esc(sellerSummary)+'</span>'+iconSvg('chevron')+'</button><div class="custom-select-menu seller-filter-menu" role="listbox" aria-label="Выбор продавцов">'+sellerAllOption+(sellerRows||'<div class="tiny muted seller-filter-empty">Продавцы пока не найдены.</div>')+'</div></div></div>';
      }

      overlay.innerHTML = '<div class="filter-modal" role="dialog" aria-modal="true" aria-labelledby="filterTitle"><div class="modal-grab" aria-label="Потяните вниз, чтобы закрыть"><span></span></div><div class="modal-content"><div class="modal-head"><div><div class="eyebrow">ТОЧНЫЙ ПОИСК</div><h2 id="filterTitle">Фильтры каталога</h2><p class="tiny muted">Комбинируй условия — результаты обновятся после применения.</p></div></div>' +
        '<div class="filter-tabs" data-active-tab="filters" role="tablist" aria-label="Разделы фильтров"><button type="button" class="filter-tab active" data-filter-tab="filters" role="tab" aria-selected="true">Фильтры</button><button type="button" class="filter-tab" data-filter-tab="sort" role="tab" aria-selected="false">Порядок вывода</button></div>' +
        '<section class="filter-tab-panel" data-filter-panel="filters"><div class="filter-grid">' +
        filterDropdown('Бренд', 'brand', brands) +
        filterDropdown('Тип / концентрация', 'type', types) +
        filterDropdown(localizedMeasureLabel(isDisplayType(filters.type)), 'volume', currentMeasureOptions(isDisplayType(filters.type))) +
        (buyerFilters ? '' : filterDropdown('Прайс-лист', 'file_id', files)) +
        filterDropdown('Пол', 'gender', genders) +
        filterDropdown('Категория', 'category', categories) +
        filterDropdown('Тестер', 'tester', [{ value: '0', label: (settings.language==='en'?'No, regular product':(settings.language==='kz'?'Жоқ, кәдімгі тауар':'Нет, обычный товар')) }, { value: '1', label: (settings.language==='en'?'Yes, tester':(settings.language==='kz'?'Иә, тестер':'Да, тестер')) }]) +
        filterDropdown('Набор', 'is_set', [{ value: '0', label: 'Одиночный товар' }, { value: '1', label: 'Набор / комплект' }]) +
        (buyerFilters ? '' : filterDropdown('Проверка парсинга', 'needs_review', [{ value: '0', label: 'Без проверки' }, { value: '1', label: 'Требует проверки' }])) +
        '</div>' + sellerFilterMarkup + '<div class="price-filter-block"><div class="price-filter-title">Интервал цен</div><div class="price-mode-toggle" data-active-mode="slider" role="group" aria-label="Способ выбора цены"><button type="button" data-price-mode="slider" class="active" aria-pressed="true">Ползунок</button><button type="button" data-price-mode="keyboard" aria-pressed="false">Клавиатура</button></div>' +
        '<div class="price-slider-view" data-price-view="slider"><div class="price-range-values"><span data-price-value="min">' + esc(priceText(sliderMinValue)) + '</span><span data-price-value="max">' + esc(priceText(sliderMaxValue)) + '</span></div><div class="dual-range" data-dual-range style="--min-pct:0%;--max-pct:100%"><div class="dual-range-track"><span></span></div><input type="range" data-price-slider="min" min="' + domainMin + '" max="' + domainMax + '" step="' + step + '" value="' + sliderMinValue + '" aria-label="Минимальная цена"><input type="range" data-price-slider="max" min="' + domainMin + '" max="' + domainMax + '" step="' + step + '" value="' + sliderMaxValue + '" aria-label="Максимальная цена"></div></div>' +
        '<div class="price-keyboard-view" data-price-view="keyboard" hidden><label class="filter-field"><span>Цена от</span><input class="input" data-filter-field="min_price" type="number" min="' + domainMin + '" max="' + domainMax + '" step="0.01" value="' + esc(filters.min_price || '') + '" placeholder="Без лимита"></label><label class="filter-field"><span>Цена до</span><input class="input" data-filter-field="max_price" type="number" min="' + domainMin + '" max="' + domainMax + '" step="0.01" value="' + esc(filters.max_price || '') + '" placeholder="Без лимита"></label></div></div></section>' +
        '<section class="filter-tab-panel sort-tab-panel" data-filter-panel="sort" hidden><div class="sort-options">' + sortMarkup() + '</div></section>' +
        '</div><div class="modal-actions"><button class="button ghost" data-filter-reset>Сбросить</button><button class="button" data-filter-apply>Показать результаты</button></div></div>';
      overlay.innerHTML = translateHtml(overlay.innerHTML);
      document.body.appendChild(overlay);
      var escHandler = null;
      var modal = overlay.querySelector('.filter-modal');
      var grab = overlay.querySelector('.modal-grab');
      var sliderMin = overlay.querySelector('[data-price-slider="min"]');
      var sliderMax = overlay.querySelector('[data-price-slider="max"]');
      var rangeWrap = overlay.querySelector('[data-dual-range]');
      var minKeyboard = overlay.querySelector('[data-filter-field="min_price"]');
      var maxKeyboard = overlay.querySelector('[data-filter-field="max_price"]');

      function close() {
        overlay.classList.add('closing');
        if (escHandler) document.removeEventListener('keydown', escHandler);
        window.setTimeout(function () { overlay.remove(); }, 240);
      }
      function closeDrops(except) {
        overlay.querySelectorAll('[data-filter-select-key], [data-seller-select]').forEach(function (drop) {
          if (drop === except) return;
          drop.classList.remove('open');
          var trigger = drop.querySelector('.custom-select-trigger');
          if (trigger) trigger.setAttribute('aria-expanded', 'false');
        });
      }
      function updatePriceUi() {
        var minValue = Number(sliderMin.value);
        var maxValue = Number(sliderMax.value);
        var span = domainMax - domainMin || 1;
        var minPct = ((minValue - domainMin) / span) * 100;
        var maxPct = ((maxValue - domainMin) / span) * 100;
        rangeWrap.style.setProperty('--min-pct', minPct + '%');
        rangeWrap.style.setProperty('--max-pct', maxPct + '%');
        overlay.querySelector('[data-price-value="min"]').textContent = priceText(minValue);
        overlay.querySelector('[data-price-value="max"]').textContent = priceText(maxValue);
      }
      function sliderToKeyboard() {
        minKeyboard.value = Number(sliderMin.value) <= domainMin ? '' : sliderMin.value;
        maxKeyboard.value = Number(sliderMax.value) >= domainMax ? '' : sliderMax.value;
      }
      function setPriceMode(mode) {
        priceMode = mode === 'keyboard' ? 'keyboard' : 'slider';
        if (priceMode === 'slider') {
          var minValue = minKeyboard.value === '' ? domainMin : Number(minKeyboard.value);
          var maxValue = maxKeyboard.value === '' ? domainMax : Number(maxKeyboard.value);
          minValue = Math.max(domainMin, Math.min(domainMax, Number.isFinite(minValue) ? minValue : domainMin));
          maxValue = Math.max(domainMin, Math.min(domainMax, Number.isFinite(maxValue) ? maxValue : domainMax));
          if (minValue > maxValue) minValue = maxValue;
          sliderMin.value = minValue; sliderMax.value = maxValue;
          updatePriceUi();
        } else {
          sliderToKeyboard();
        }
        var priceToggle = overlay.querySelector('.price-mode-toggle');
        if (priceToggle) priceToggle.setAttribute('data-active-mode', priceMode);
        overlay.querySelectorAll('[data-price-mode]').forEach(function (button) {
          var active = button.getAttribute('data-price-mode') === priceMode;
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        overlay.querySelectorAll('[data-price-view]').forEach(function (view) {
          var show = view.getAttribute('data-price-view') === priceMode;
          view.hidden = !show;
          if (show) { view.classList.remove('is-entering'); void view.offsetWidth; view.classList.add('is-entering'); }
        });
      }
      function setSort(value) {
        selectedSort = value;
        overlay.querySelectorAll('[data-sort-value]').forEach(function (button) {
          var active = button.getAttribute('data-sort-value') === selectedSort;
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', active ? 'true' : 'false');
          var check = button.querySelector('.svg-icon');
          if (check) check.remove();
          if (active) button.insertAdjacentHTML('beforeend', iconSvg('check'));
        });
      }
      function setTab(tab) {
        var tabs = overlay.querySelector('.filter-tabs');
        if (tabs) tabs.setAttribute('data-active-tab', tab);
        overlay.querySelectorAll('[data-filter-tab]').forEach(function (button) {
          var active = button.getAttribute('data-filter-tab') === tab;
          button.classList.toggle('active', active);
          button.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        overlay.querySelectorAll('[data-filter-panel]').forEach(function (panel) {
          var show = panel.getAttribute('data-filter-panel') === tab;
          panel.hidden = !show;
          if (show) { panel.classList.remove('is-entering'); void panel.offsetWidth; panel.classList.add('is-entering'); }
        });
        closeDrops(null);
      }

      function bindFilterDropdown(drop) {
        var trigger = drop.querySelector('.custom-select-trigger');
        if (!drop.getAttribute('data-handler-bound')) {
          trigger.onclick = function (event) {
            event.stopPropagation();
            var willOpen = !drop.classList.contains('open');
            closeDrops(drop);
            drop.classList.toggle('open', willOpen);
            trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
          };
          drop.setAttribute('data-handler-bound','1');
        }
        drop.querySelectorAll('[data-filter-value]').forEach(function (option) {
          if (option.getAttribute('data-handler-bound') === '1') return;
          option.setAttribute('data-handler-bound','1');
          option.onclick = function (event) {
            event.stopPropagation();
            var value = option.getAttribute('data-filter-value') || '';
            var label = option.getAttribute('data-filter-label') || localizedAllLabel();
            drop.setAttribute('data-selected-value', value);
            trigger.querySelector('span').textContent = label;
            drop.querySelectorAll('[data-filter-value]').forEach(function (other) {
              var selected = other === option;
              other.classList.toggle('selected', selected);
              other.setAttribute('aria-selected', selected ? 'true' : 'false');
              var check = other.querySelector('.svg-icon');
              if (check) check.remove();
              if (selected) other.insertAdjacentHTML('beforeend', iconSvg('check'));
            });
            drop.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
            if (drop.getAttribute('data-filter-select-key') === 'type') refreshMeasureDropdown();
          };
        });
      }
      function refreshMeasureDropdown(){
        var drop=overlay.querySelector('[data-filter-select-key="volume"]');if(!drop)return;
        var display=isDisplayType(selectedTypeInModal());var options=currentMeasureOptions(display);var current=drop.getAttribute('data-selected-value')||'';
        var exists=options.some(function(item){return String(item.value)===current;});if(current&&!exists)current='';
        drop.setAttribute('data-selected-value',current);
        var field=drop.parentNode;var fieldTitle=field.querySelector(':scope > span');if(fieldTitle)fieldTitle.textContent=localizedMeasureLabel(display);
        var trigger=drop.querySelector('.custom-select-trigger');var selected=options.filter(function(item){return String(item.value)===current;})[0];
        trigger.querySelector('span').textContent=selected?selected.label:localizedAllLabel();
        var all=[{value:'',label:localizedAllLabel()}].concat(options);var menu=drop.querySelector('.custom-select-menu');
        menu.innerHTML=all.map(function(item){var value=String(item.value==null?'':item.value);var active=value===current;return '<button type="button" role="option" aria-selected="'+(active?'true':'false')+'" data-filter-value="'+esc(value)+'" data-filter-label="'+esc(item.label)+'" class="custom-select-option'+(active?' selected':'')+'">'+esc(item.label)+(active?iconSvg('check'):'')+'</button>';}).join('');
        var sortLabel=overlay.querySelector('[data-sort-value="volume"] span');if(sortLabel)sortLabel.textContent=localizedMeasureLabel(display);
        bindFilterDropdown(drop);
      }
      overlay.querySelectorAll('[data-filter-select-key]').forEach(bindFilterDropdown);
      function paintSellerFilters(){overlay.querySelectorAll('[data-seller-filter-id]').forEach(function(button){var id=Number(button.getAttribute('data-seller-filter-id'));var checked=selectedSellerIds.indexOf(id)!==-1;button.classList.toggle('selected',checked);button.setAttribute('aria-pressed',checked?'true':'false');button.setAttribute('aria-selected',checked?'true':'false');var box=button.querySelector('.seller-filter-checkbox');if(box)box.innerHTML=checked?'<i class="seller-filter-dot"></i>':'';});var all=overlay.querySelector('[data-seller-filter-all]');if(all){var checkedAll=selectedSellerIds.length===0;all.classList.toggle('selected',checkedAll);all.setAttribute('aria-pressed',checkedAll?'true':'false');all.setAttribute('aria-selected',checkedAll?'true':'false');var boxAll=all.querySelector('.seller-filter-checkbox');if(boxAll)boxAll.innerHTML=checkedAll?'<i class="seller-filter-dot"></i>':'';}var summary=overlay.querySelector('[data-seller-filter-summary]');if(summary){if(!selectedSellerIds.length)summary.textContent='Все продавцы';else if(selectedSellerIds.length===1){var chosen=(opts.sellers||[]).filter(function(s){return Number(s.tg_id)===selectedSellerIds[0];})[0];summary.textContent=chosen?(chosen.full_name||'Продавец'):'Выбран 1 продавец';}else summary.textContent='Выбрано продавцов: '+selectedSellerIds.length;}}
      var sellerDrop=overlay.querySelector('[data-seller-select]');if(sellerDrop){var sellerTrigger=sellerDrop.querySelector('.custom-select-trigger');sellerTrigger.onclick=function(event){event.stopPropagation();var willOpen=!sellerDrop.classList.contains('open');closeDrops(sellerDrop);sellerDrop.classList.toggle('open',willOpen);sellerTrigger.setAttribute('aria-expanded',willOpen?'true':'false');};}
      overlay.querySelectorAll('[data-seller-filter-id]').forEach(function(button){button.onclick=function(event){event.stopPropagation();var id=Number(button.getAttribute('data-seller-filter-id'));var at=selectedSellerIds.indexOf(id);if(at===-1)selectedSellerIds.push(id);else selectedSellerIds.splice(at,1);paintSellerFilters();};});
      var sellerAll=overlay.querySelector('[data-seller-filter-all]');if(sellerAll)sellerAll.onclick=function(event){event.stopPropagation();selectedSellerIds=[];paintSellerFilters();};
      overlay.querySelectorAll('[data-filter-tab]').forEach(function (button) {
        button.onclick = function () { setTab(button.getAttribute('data-filter-tab')); };
      });
      overlay.querySelectorAll('[data-sort-value]').forEach(function (button) {
        button.onclick = function () { setSort(button.getAttribute('data-sort-value')); };
      });
      overlay.querySelectorAll('[data-price-mode]').forEach(function (button) {
        button.onclick = function () { setPriceMode(button.getAttribute('data-price-mode')); };
      });
      [sliderMin, sliderMax].forEach(function (slider) {
        var side = slider.getAttribute('data-price-slider');
        var label = overlay.querySelector('[data-price-value="' + side + '"]');
        function activate() { label.classList.add('is-active'); slider.classList.add('is-active'); }
        function deactivate() { label.classList.remove('is-active'); slider.classList.remove('is-active'); }
        slider.addEventListener('pointerdown', activate);
        slider.addEventListener('pointerup', deactivate);
        slider.addEventListener('pointercancel', deactivate);
        slider.addEventListener('blur', deactivate);
        slider.addEventListener('focus', activate);
        slider.addEventListener('input', function () {
          if (Number(sliderMin.value) > Number(sliderMax.value)) {
            if (side === 'min') sliderMax.value = sliderMin.value;
            else sliderMin.value = sliderMax.value;
          }
          updatePriceUi();
        });
      });
      minKeyboard.addEventListener('input', function () {
        if (minKeyboard.value !== '' && maxKeyboard.value !== '' && Number(minKeyboard.value) > Number(maxKeyboard.value)) maxKeyboard.value = minKeyboard.value;
      });
      maxKeyboard.addEventListener('input', function () {
        if (minKeyboard.value !== '' && maxKeyboard.value !== '' && Number(maxKeyboard.value) < Number(minKeyboard.value)) minKeyboard.value = maxKeyboard.value;
      });
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) close();
        else if (!event.target.closest('[data-filter-select-key], [data-seller-select]')) closeDrops(null);
      });
      overlay.querySelector('[data-filter-reset]').onclick = function () {
        overlay.querySelectorAll('[data-filter-select-key]').forEach(function (drop) {
          drop.setAttribute('data-selected-value', '');
          var trigger = drop.querySelector('.custom-select-trigger');
          trigger.querySelector('span').textContent = localizedAllLabel();
          drop.querySelectorAll('[data-filter-value]').forEach(function (option) {
            var selected = option.getAttribute('data-filter-value') === '';
            option.classList.toggle('selected', selected);
            option.setAttribute('aria-selected', selected ? 'true' : 'false');
            var check = option.querySelector('.svg-icon');
            if (check) check.remove();
            if (selected) option.insertAdjacentHTML('beforeend', iconSvg('check'));
          });
        });
        minKeyboard.value = ''; maxKeyboard.value = '';
        selectedSellerIds=[];paintSellerFilters(); refreshMeasureDropdown();
        sliderMin.value = domainMin; sliderMax.value = domainMax;
        updatePriceUi(); setPriceMode('slider'); setSort('price_asc');
      };
      overlay.querySelector('[data-filter-apply]').onclick = function () {
        var next = {};
        overlay.querySelectorAll('[data-filter-select-key]').forEach(function (drop) {
          next[drop.getAttribute('data-filter-select-key')] = drop.getAttribute('data-selected-value') || '';
        });
        if(sellerFilterEnabled)next.seller_ids=selectedSellerIds.slice();
        if (priceMode === 'keyboard') {
          next.min_price = minKeyboard.value;
          next.max_price = maxKeyboard.value;
        } else {
          var currentMin = Number(sliderMin.value);
          var currentMax = Number(sliderMax.value);
          next.min_price = currentMin <= domainMin ? '' : String(currentMin);
          next.max_price = currentMax >= domainMax ? '' : String(currentMax);
        }
        onApply(next, selectedSort);
        close();
      };
      escHandler = function (event) { if (event.key === 'Escape') close(); };
      document.addEventListener('keydown', escHandler);
      updatePriceUi(); setPriceMode('slider');

      // The handle accepts both a deliberate pull and a quick downward flick.
      if (grab && modal && window.PointerEvent) {
        var dragStart = 0, dragDelta = 0, lastY = 0, lastTime = 0, velocity = 0, dragging = false;
        grab.addEventListener('pointerdown', function (event) {
          if (event.button !== undefined && event.button !== 0) return;
          dragging = true; dragStart = event.clientY; lastY = event.clientY; lastTime = event.timeStamp; dragDelta = 0; velocity = 0;
          modal.classList.add('is-dragging');
          try { grab.setPointerCapture(event.pointerId); } catch (e) {}
        });
        grab.addEventListener('pointermove', function (event) {
          if (!dragging) return;
          dragDelta = Math.max(0, event.clientY - dragStart);
          var elapsed = event.timeStamp - lastTime;
          if (elapsed > 0) velocity = (event.clientY - lastY) / elapsed;
          lastY = event.clientY; lastTime = event.timeStamp;
          modal.style.transform = 'translate3d(0,' + dragDelta + 'px,0)';
        });
        function finishDrag() {
          if (!dragging) return;
          dragging = false;
          modal.classList.remove('is-dragging');
          var shouldClose = dragDelta > 72 || (velocity > 0.62 && dragDelta > 16);
          if (shouldClose) close();
          else { modal.style.transform = ''; modal.style.transition = ''; }
          dragDelta = 0; velocity = 0;
        }
        grab.addEventListener('pointerup', finishDrag);
        grab.addEventListener('pointercancel', finishDrag);
      }
      window.setTimeout(function () { overlay.classList.add('is-open'); }, 10);
    }).catch(function (e) { toast(friendlyError(e)); });
  }
  function favoriteStarSvg(active) {
    return '<svg class="favorite-star-icon favorite-heart-icon" viewBox="0 0 24 24" aria-hidden="true" '+(active?'fill="currentColor"':'fill="none"')+' stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"/></svg>';
  }
  function isDisplayProduct(p) { return !!p && ['DISPLAY','SHOWCARD','BILLBOARD'].indexOf(String(p.type||'').toUpperCase())!==-1; }
  function productMeasureText(p) {
    p=p||{};
    if(isDisplayProduct(p)){
      var width=Number(p.size_width),height=Number(p.size_height),unit=String(p.size_unit||'cm').toLowerCase()==='mm'?(settings.language==='en'?'mm':'мм'):(settings.language==='en'?'cm':'см');
      if(width>0&&height>0){var numberFormat=function(n){return Number(n).toLocaleString(localeTag(),{maximumFractionDigits:3});};return numberFormat(width)+' × '+numberFormat(height)+' '+unit;}
      return settings.language==='en'?'size not specified':(settings.language==='kz'?'өлшем көрсетілмеген':'размер не указан');
    }
    if(p.volume_text)return p.volume_text;
    if(p.volume_ml)return p.volume_ml+(settings.language==='en'?' ml':settings.language==='kz'?' мл':' мл');
    return settings.language==='en'?'volume not specified':(settings.language==='kz'?'көлемі көрсетілмеген':'объём не указан');
  }
  function localizedProductType(value) {
    var code=String(value||'').toUpperCase();
    var ru={DISPLAY:'Дисплей',SHOWCARD:'Шоукард',BILLBOARD:'Билборд'},en={DISPLAY:'Display',SHOWCARD:'Showcard',BILLBOARD:'Billboard'},kz={DISPLAY:'Дисплей',SHOWCARD:'Шоукард',BILLBOARD:'Билборд'};
    var map=settings.language==='en'?en:(settings.language==='kz'?kz:ru);
    return map[code]||String(value||'тип не указан');
  }
  function productMeasureLabel(p){var display=isDisplayProduct(p);return settings.language==='en'?(display?'Size':'Volume'):(settings.language==='kz'?(display?'Өлшем':'Көлем'):(display?'Размер':'Объём'));}
  function productCardMarkup(p, isBuyer) {
    var parts=[localizedProductType(p.type),productMeasureText(p)];
    if(!isBuyer&&!Number(p.public_catalog_fallback)&&p.filename)parts.push(p.filename);
    var finalPrice=Number(currentRole==='buyer'?p.price_usd:(p.base_price!==undefined?p.base_price:p.price_usd));
    var multiplier=Number(p.price_multiplier||1);
    var effectivePrice=p.effective_price!==undefined?Number(p.effective_price):finalPrice*multiplier;
    var boosted=!isBuyer?'<div class="product-price-boost '+(effectivePrice<finalPrice?'is-lower':'')+'">(x'+esc(multiplier.toLocaleString(localeTag(),{minimumFractionDigits:2,maximumFractionDigits:2}))+') '+esc(fmtMoney(effectivePrice,p.currency))+'</div>':'';
    var canFavorite=isBuyer||currentRole==='seller'||currentRole==='admin'||isAdmin;
    var favorite=canFavorite?'<button type="button" class="favorite-toggle '+(Number(p.is_favorite)?'active':'')+'" data-favorite-id="'+Number(p.id)+'" data-favorite-active="'+(Number(p.is_favorite)?'1':'0')+'" aria-pressed="'+(Number(p.is_favorite)?'true':'false')+'" aria-label="'+(Number(p.is_favorite)?'Убрать из избранного':'Добавить в избранное')+'" title="'+(Number(p.is_favorite)?'Убрать из избранного':'Добавить в избранное')+'">'+favoriteStarSvg(!!Number(p.is_favorite))+'</button>':'';
    return '<article class="product-card '+(isBuyer?'buyer-product-card':'')+' '+(canFavorite?'product-card-has-favorite':'')+'" data-open-product="'+Number(p.id)+'" tabindex="0" role="button" aria-label="Подробнее о товаре"><div class="product-card-info"><div class="product-heading-line"><div class="product-name">'+esc(p.brand?p.brand+' — ':'')+esc(p.name)+'</div></div><div class="product-sub">'+esc(parts.join(' · '))+'</div></div><div class="product-price-wrap"><div class="product-price">'+esc(fmtMoney(finalPrice,p.currency))+'</div>'+boosted+(canFavorite?'<div class="product-favorite-under-price">'+favorite+'</div>':'')+'</div><div class="product-tag">'+(p.is_tester?'<span class="tag">'+(settings.language==='en'?'Tester':'Тестер')+'</span>':'')+(p.is_set?'<span class="tag">Набор</span>':'')+((currentRole!=='buyer'&&p.needs_review)?'<span class="tag">Нужна проверка</span>':'')+'</div></article>';
  }
  function bindProductCards(root){
    if(!root)return;root.querySelectorAll('[data-open-product]').forEach(function(card){if(card.dataset.productBound==='1')return;card.dataset.productBound='1';card.addEventListener('click',function(e){if(e.target.closest('button,a,input,select,textarea'))return;openProductModal(Number(card.getAttribute('data-open-product')));});card.addEventListener('keydown',function(e){if((e.key==='Enter'||e.key===' ')&&e.target===card){e.preventDefault();openProductModal(Number(card.getAttribute('data-open-product')));}});});
  }
  function openProductModal(productId){
    if(!Number.isInteger(Number(productId))||Number(productId)<1)return;
    var old=document.getElementById('productDetailOverlay');if(old)old.remove();
    var overlay=document.createElement('div');overlay.id='productDetailOverlay';overlay.className='modal-backdrop product-detail-backdrop';
    overlay.innerHTML='<section class="filter-modal modal-filter product-detail-modal" role="dialog" aria-modal="true" aria-labelledby="productDetailTitle"><div class="modal-grab" aria-label="Потяните вниз, чтобы закрыть"><span></span></div><div class="modal-content product-detail-content"><div class="loading-card"><div class="spinner"></div>Загружаем товар…</div></div></section>';
    document.body.appendChild(overlay);var popup=overlay.querySelector('.product-detail-modal');bindSheetDrag(overlay,popup);
    function close(){if(!overlay.isConnected)return;overlay.classList.add('closing');document.removeEventListener('keydown',onKey);setTimeout(function(){if(overlay.isConnected)overlay.remove();},240);}
    function onKey(e){if(e.key==='Escape')close();}document.addEventListener('keydown',onKey);overlay.addEventListener('click',function(e){if(e.target===overlay)close();});setTimeout(function(){if(overlay.isConnected)overlay.classList.add('is-open');},10);
    api('product_details',{product_id:Number(productId)}).then(function(p){if(!overlay.isConnected)return;
      var isBuyer=currentRole==='buyer',canFavorite=!!p.can_favorite,base=Number(p.base_price||0),boost=Number(p.effective_price||base*Number(p.price_multiplier||1)),currency=p.currency||'USD';
      var sellerName=p.seller_name|| (p.seller_username?'@'+p.seller_username:'Продавец · ID '+p.seller_tg_id);
      var details='';
      function field(label,value,wide){return '<div class="product-detail-field'+(wide?' product-detail-field-wide':'')+'"><span>'+esc(label)+'</span><strong>'+esc(value==null||value===''?'—':String(value))+'</strong></div>';}
      details+=field('Название',p.name);details+=field('Бренд',p.brand);details+=field(productMeasureLabel(p),productMeasureText(p));details+=field('Тип',localizedProductType(p.type));details+=field('Категория',p.category);details+=field('Пол',p.gender==='M'?'Мужской':(p.gender==='F'?'Женский':(p.gender?'Унисекс':'—')));details+=field('Тестер',Number(p.is_tester)?'Да':'Нет');details+=field('Набор',Number(p.is_set)?'Да':'Нет');
      details+=field('Цена',fmtMoney(isBuyer?boost:base,currency));if(!isBuyer)details+=field('Цена с множителем',fmtMoney(boost,currency));
      if(!isBuyer&&!Number(p.public_catalog_fallback))details+=field('Прайс-лист',p.filename||'—',true);
      details+=field('Продавец',sellerName);
      var sellerDraft='Здравствуйте! Интересует товар: '+[p.brand,p.name,productMeasureText(p),localizedProductType(p.type)].filter(Boolean).join(' · ')+'.';
      var sellerHref=p.seller_username?'https://t.me/'+encodeURIComponent(String(p.seller_username).replace(/^@/,''))+'?text='+encodeURIComponent(sellerDraft):(p.seller_tg_id?'tg://user?id='+encodeURIComponent(String(p.seller_tg_id)):'' );
      var html='<div class="product-detail-eyebrow">КАТАЛОГ BASALT</div><h2 id="productDetailTitle">'+esc(p.brand?p.brand+' — '+p.name:p.name)+'</h2><div class="product-detail-fields">'+details+'</div><div class="product-detail-actions">';
      if(canFavorite)html+='<button type="button" class="button full product-detail-favorite" data-detail-favorite="'+Number(p.id)+'" data-favorite-active="'+(Number(p.is_favorite)?'1':'0')+'">'+favoriteStarSvg(!!Number(p.is_favorite))+'<span>'+(Number(p.is_favorite)?'Убрать из избранного':'Добавить в избранное')+'</span></button>';
      if(!Number(p.public_catalog_fallback)&&(currentRole==='seller'||currentRole==='admin'||isAdmin)&&p.file_id&&String(p.file_status)==='ready')html+='<button type="button" class="button secondary full" data-detail-download="'+Number(p.file_id)+'">Скачать прайс-лист '+iconSvg('arrow')+'</button>';
      if((isBuyer||isAdmin||currentRole==='admin')&&sellerHref&&(isAdmin||Number(p.seller_dm_available)===1))html+='<a class="button secondary full telegram-link" href="'+esc(sellerHref)+'" '+(p.seller_username?'target="_blank" rel="noopener noreferrer"':'')+'>Связаться с продавцом '+iconSvg('arrow')+'</a>';else if((isBuyer||isAdmin||currentRole==='admin')&&!isAdmin)html+='<button class="button secondary full contact-seller-disabled" type="button" disabled aria-disabled="true" title="Продавец отключил личные сообщения">Связаться с продавцом '+iconSvg('arrow')+'</button>';
      html+='</div>';
      popup.querySelector('.product-detail-content').innerHTML=html;
      var detailFields=popup.querySelector('.product-detail-fields');
      function sizeOrphanDetailField(){if(!detailFields||!detailFields.isConnected)return;detailFields.querySelectorAll('.product-detail-field-auto-wide').forEach(function(el){el.classList.remove('product-detail-field-auto-wide');});var children=Array.prototype.slice.call(detailFields.children);if(children.length<2)return;var columns=getComputedStyle(detailFields).gridTemplateColumns.split(/\s+/).filter(Boolean).length;if(columns<2)return;var last=children[children.length-1],previous=children[children.length-2];if(last.classList.contains('product-detail-field-wide'))return;if(last.getBoundingClientRect().top>previous.getBoundingClientRect().top+3)last.classList.add('product-detail-field-auto-wide');}
      requestAnimationFrame(sizeOrphanDetailField);window.addEventListener('resize',sizeOrphanDetailField);
      var originalClose=close;close=function(){window.removeEventListener('resize',sizeOrphanDetailField);originalClose();};
      var fav=popup.querySelector('[data-detail-favorite]');if(fav)fav.onclick=function(){fav.disabled=true;api('favorite_toggle',{product_id:Number(productId),favorite:fav.getAttribute('data-favorite-active')!=='1'}).then(function(r){fav.setAttribute('data-favorite-active',r.is_favorite?'1':'0');fav.innerHTML=favoriteStarSvg(!!r.is_favorite)+'<span>'+(r.is_favorite?'Убрать из избранного':'Добавить в избранное')+'</span>';updateFavoritesCount(r.favorites_count);document.querySelectorAll('[data-favorite-id="'+Number(productId)+'"]').forEach(function(b){b.setAttribute('data-favorite-active',r.is_favorite?'1':'0');b.classList.toggle('active',!!r.is_favorite);b.setAttribute('aria-pressed',r.is_favorite?'true':'false');b.innerHTML=favoriteStarSvg(!!r.is_favorite);});fav.disabled=false;delete cache.favorites;var favoritesOverlay=document.getElementById('favoritesOverlay');if(favoritesOverlay)favoritesOverlay.dispatchEvent(new CustomEvent('basalt:favorites-refresh'));}).catch(function(err){fav.disabled=false;toast(err);});};
      var dl=popup.querySelector('[data-detail-download]');if(dl)dl.onclick=function(){var fileId=Number(dl.getAttribute('data-detail-download'));if(currentRole==='admin'||isAdmin)openBotLink('admin_download_'+Number(p.seller_tg_id)+'_'+fileId);else openBotLink('download_'+fileId);};
    }).catch(function(err){if(!overlay.isConnected)return;popup.querySelector('.product-detail-content').innerHTML='<div class="empty"><strong>Не удалось загрузить товар</strong><p class="tiny">'+esc(friendlyError(err))+'</p><button type="button" class="button secondary" data-product-detail-close>Закрыть</button></div>';var b=popup.querySelector('[data-product-detail-close]');if(b)b.onclick=close;});
  }
  function updateFavoritesCount(count) {
    var number=Number(count||0);if(overview)overview.favorites_count=number;
    document.querySelectorAll('[data-favorites-count]').forEach(function(el){el.textContent=number.toLocaleString(localeTag());});
    if(cache.overview)cache.overview.time=0;
  }
  function bindFavoriteButtons(root) {
    if(!root)return;
    root.querySelectorAll('[data-favorite-id]').forEach(function(button){
      if(button.dataset.favoriteBound==='1')return;button.dataset.favoriteBound='1';
      button.addEventListener('click',function(event){event.preventDefault();event.stopPropagation();var id=Number(button.getAttribute('data-favorite-id'));var active=button.getAttribute('data-favorite-active')==='1';button.disabled=true;
        api('favorite_toggle',{product_id:id,favorite:!active}).then(function(result){
          var next=!!result.is_favorite;document.querySelectorAll('[data-favorite-id="'+id+'"]').forEach(function(peer){peer.setAttribute('data-favorite-active',next?'1':'0');peer.classList.toggle('active',next);peer.setAttribute('aria-pressed',next?'true':'false');peer.setAttribute('aria-label',next?'Убрать из избранного':'Добавить в избранное');peer.title=next?'Убрать из избранного':'Добавить в избранное';peer.innerHTML=favoriteStarSvg(next);peer.disabled=false;});
          updateFavoritesCount(result.favorites_count);if(!next){var overlay=document.getElementById('favoritesOverlay');if(overlay){var row=overlay.querySelector('.product-card[data-product-id="'+id+'"]');if(row)row.remove();var list=overlay.querySelector('#favoritesResults');if(list&&!list.querySelector('.product-card'))list.innerHTML='<div class="empty"><div class="symbol">'+favoriteStarSvg(false)+'</div><strong>Избранное пока пусто</strong><p class="tiny">Добавляйте товары в избранное кнопкой со звёздочкой в поиске.</p></div>';}}
        }).catch(function(error){button.disabled=false;toast(error);});
      });
    });
  }
  function openFavoritesModal() {
    var old=document.getElementById('favoritesOverlay');if(old)old.remove();
    var overlay=document.createElement('div');overlay.id='favoritesOverlay';overlay.className='modal-backdrop';
    overlay.innerHTML='<section class="filter-modal modal-filter favorites-modal" role="dialog" aria-modal="true" aria-labelledby="favoritesModalTitle"><div class="modal-grab"><span></span></div><div class="modal-content"><div class="row favorites-modal-heading"><div><p class="eyebrow">ЛИЧНАЯ ПОДБОРКА</p><h2 id="favoritesModalTitle">Избранные товары</h2></div></div><div class="search-box favorites-search-box"><span>'+iconSvg('search')+'</span><input id="favoritesQuery" placeholder="Поиск среди избранного" autocomplete="off"></div><div class="result-bar"><div class="tiny muted" id="favoritesResultCount">Загружаем избранное…</div></div><div id="favoritesResults"><div class="loading-card"><div class="spinner"></div>Загружаем товары…</div></div></div></section>';
    document.body.appendChild(overlay);var modal=overlay.querySelector('.favorites-modal');bindSheetDrag(overlay,modal);
    function close(){if(!overlay.isConnected)return;overlay.classList.add('closing');setTimeout(function(){if(overlay.isConnected)overlay.remove();},220);document.removeEventListener('keydown',onKey);}
    function onKey(e){if(e.key==='Escape')close();}document.addEventListener('keydown',onKey);overlay.addEventListener('click',function(e){if(e.target===overlay)close();});
    setTimeout(function(){if(overlay.isConnected)overlay.classList.add('is-open');},10);
    var rows=[];var query='';var currentShareGroups=Object.create(null);
    // Share destinations are real anchors. Do not cancel or intercept default navigation:
    // Telegram WebViews can silently swallow JS-opened t.me links, while a user-clicked
    // <a target="_blank"> is handled by the host application as expected.
    overlay.addEventListener('click',function(event){var link=event.target&&event.target.closest?event.target.closest('a[data-share-favorites]'):null;if(!link||!overlay.contains(link))return;var group=currentShareGroups[String(link.getAttribute('data-share-favorites')||'')];if(!group){event.preventDefault();toast('Не удалось найти товары этого продавца. Обновите избранное и попробуйте снова.');return;}try{copyText(sellerGroupText(group)).then(function(){toast('Список скопирован — он также откроется в Telegram.');}).catch(function(){});}catch(copyError){} });
    overlay.addEventListener('basalt:favorites-refresh',function(){api('favorites').then(function(updated){if(!overlay.isConnected)return;rows=Array.isArray(updated)?updated:rows;updateFavoritesCount(rows.length);renderRows();}).catch(function(){});});
    function sellerGroupText(group){
      var lines=['Здравствуйте! Хочу уточнить наличие товаров из вашего прайс-листа:',''];
      group.items.forEach(function(p,index){
        var detail=[p.brand,p.name].filter(Boolean).join(' — ');
        lines.push((index+1)+'. '+(detail||p.name||'Товар'));
        lines.push((isDisplayProduct(p)?'Размер: ':'Объём: ')+productMeasureText(p));
        lines.push('Тип: '+localizedProductType(p.type));
        lines.push('Тестер: '+(Number(p.is_tester)?'да':'нет'));
        if(Number(p.is_set))lines.push('Набор: да');
        lines.push('Цена: '+fmtMoney(Number(p.effective_price!==undefined?p.effective_price:(p.price_usd||0)),p.currency));
        lines.push('');
      });
      return lines.join('\n').trim();
    }
    function showShareComposer(group,text){
      var oldShare=document.getElementById('favoritesShareComposer');if(oldShare)oldShare.remove();
      var shareOverlay=document.createElement('div');shareOverlay.id='favoritesShareComposer';shareOverlay.className='modal-backdrop favorites-share-backdrop';
      shareOverlay.innerHTML='<section class="filter-modal modal-filter favorites-share-composer" role="dialog" aria-modal="true" aria-labelledby="favoritesShareTitle"><div class="modal-grab"><span></span></div><div class="modal-content"><p class="eyebrow">ИЗБРАННОЕ</p><h2 id="favoritesShareTitle">Поделиться списком</h2><p class="tiny muted">'+esc(group.name||'Продавец')+' · '+group.items.length+' товаров. Скопируйте текст или откройте Telegram — полный список будет готов к вставке.</p><textarea class="input favorites-share-text" id="favoritesShareText" rows="10" readonly></textarea><div class="favorites-share-actions"><button type="button" class="button secondary" id="copyFavoritesShareText">Скопировать текст</button><button type="button" class="button" id="openFavoritesShareTelegram">Открыть Telegram '+iconSvg('arrow')+'</button></div><p class="tiny muted" id="favoritesShareStatus" aria-live="polite"></p></div></section>';
      document.body.appendChild(shareOverlay);var shareModal=shareOverlay.querySelector('.favorites-share-composer');shareOverlay.querySelector('#favoritesShareText').value=text;bindSheetDrag(shareOverlay,shareModal);
      function closeShare(){if(!shareOverlay.isConnected)return;shareOverlay.classList.add('closing');setTimeout(function(){if(shareOverlay.isConnected)shareOverlay.remove();},220);document.removeEventListener('keydown',shareKey);}
      function shareKey(e){if(e.key==='Escape')closeShare();}document.addEventListener('keydown',shareKey);shareOverlay.addEventListener('click',function(e){if(e.target===shareOverlay)closeShare();});
      shareOverlay.querySelector('#copyFavoritesShareText').onclick=function(){var textarea=shareOverlay.querySelector('#favoritesShareText');copyText(text).then(function(){shareOverlay.querySelector('#favoritesShareStatus').textContent='Список скопирован. Его можно вставить в сообщение продавцу.';toast('Список скопирован');}).catch(function(){textarea.focus();textarea.select();textarea.setSelectionRange(0,textarea.value.length);shareOverlay.querySelector('#favoritesShareStatus').textContent='Не удалось скопировать автоматически. Текст выделен — скопируйте его вручную.';});};
      shareOverlay.querySelector('#openFavoritesShareTelegram').onclick=function(){var username=String(group.username||'').replace(/^@/,'').trim();var encoded=encodeURIComponent(text);var url='';if(username&&encoded.length<1800)url='https://t.me/'+encodeURIComponent(username)+'?text='+encoded;else if(username)url='https://t.me/'+encodeURIComponent(username);else {var bot=String(botUsername||'').replace(/^@/,'').trim();var shareTarget=bot&&bot!=='YOUR_BOT_USERNAME'?'https://t.me/'+bot:'https://t.me';url='https://t.me/share/url?url='+encodeURIComponent(shareTarget)+(encoded.length<6500?'&text='+encoded:'');}
        // Copy starts immediately from the click; opening Telegram remains in the same gesture.
        copyText(text).catch(function(){});var opened=openTelegramUrl(url);if(opened){shareOverlay.querySelector('#favoritesShareStatus').textContent=username?(encoded.length<1800?'Открываем чат продавца с подготовленным сообщением.':'Чат продавца открыт. Вставьте полный список из буфера обмена.'):'Открылось меню Telegram. Выберите чат продавца; список уже скопирован.';}else{shareOverlay.querySelector('#favoritesShareStatus').textContent='Telegram не удалось открыть автоматически. Скопируйте текст и вставьте его в чат продавца.';var area=shareOverlay.querySelector('#favoritesShareText');area.focus();area.select();}};
      setTimeout(function(){if(shareOverlay.isConnected)shareOverlay.classList.add('is-open');},10);
    }
    function sellerShareHref(group){
      var text=sellerGroupText(group),encodedText=encodeURIComponent(text),username=String(group.username||'').replace(/^@/,'').trim();
      if(username){
        // A normal anchor is deliberately used instead of openTelegramUrl(). A public
        // username opens the exact chat; short and medium messages arrive prefilled.
        if(encodedText.length<6000)return 'https://t.me/'+encodeURIComponent(username)+'?text='+encodedText;
        return 'https://t.me/'+encodeURIComponent(username);
      }
      // Telegram cannot deep-link a private user chat by numeric ID. The share sheet is
      // the supported route in that case; the message is copied by the click handler.
      var bot=String(botUsername||'').replace(/^@/,'').trim();
      var target=bot&&bot!=='YOUR_BOT_USERNAME'?'https://t.me/'+bot:'https://t.me';
      return 'https://t.me/share/url?url='+encodeURIComponent(target)+(encodedText.length<6500?'&text='+encodedText:'');
    }
    function openSellerShare(group){
      if(!group||!Array.isArray(group.items)||!group.items.length){toast('В этом разделе пока нет товаров для отправки.');return;}
      showShareComposer(group,sellerGroupText(group));
    }
    function renderRows(){
      var q=query.toLocaleLowerCase();
      var filtered=rows.filter(function(p){return !q||[p.brand,p.name,p.type,p.volume_text,p.volume_ml,p.size_width,p.size_height,p.category,p.seller_name,p.seller_username].join(' ').toLocaleLowerCase().indexOf(q)!==-1;});
      overlay.querySelector('#favoritesResultCount').textContent=filtered.length+' из '+rows.length+' товаров';
      var target=overlay.querySelector('#favoritesResults');
      if(!rows.length)target.innerHTML='<div class="empty"><div class="symbol">'+favoriteStarSvg(false)+'</div><strong>Избранное пока пусто</strong><p class="tiny">Нажмите на сердечко в строке товара на странице поиска, чтобы сохранить его здесь.</p></div>';
      else if(!filtered.length)target.innerHTML='<div class="empty"><strong>Ничего не найдено</strong><p class="tiny">Попробуйте изменить запрос.</p></div>';
      else {
        var groupMap={},groups=[];
        filtered.forEach(function(p){var id=String(p.seller_tg_id||'unknown');if(!groupMap[id]){groupMap[id]={sellerId:Number(p.seller_tg_id||0),name:p.seller_name|| (p.seller_username?'@'+p.seller_username:'Продавец'),username:p.seller_username||'',dmAvailable:!!Number(p.seller_dm_available)||!!isAdmin,items:[]};groups.push(groupMap[id]);}groupMap[id].items.push(p);});
        currentShareGroups=Object.create(null);
        target.innerHTML=groups.map(function(group){
          group.shareKey=String(group.sellerId||'unknown');currentShareGroups[group.shareKey]=group;
          var cards=group.items.map(function(p){return productCardMarkup(p,true);}).join('');
          var shareAction=group.dmAvailable?'<a class="button secondary favorite-share-button telegram-link" href="'+esc(sellerShareHref(group))+'" target="_blank" rel="noopener noreferrer" data-share-favorites="'+esc(group.shareKey)+'">Поделиться списком '+iconSvg('arrow')+'</a>':'<button type="button" class="button secondary favorite-share-button favorite-share-disabled" disabled aria-disabled="true" title="Продавец отключил личные сообщения">Поделиться списком '+iconSvg('arrow')+'</button>';return '<section class="favorite-seller-group"><div class="favorite-seller-heading"><div class="favorite-seller-title"><strong>'+esc(group.name)+'</strong><span class="favorite-seller-count"> — '+group.items.length+' '+(group.items.length===1?'товар':(group.items.length>=2&&group.items.length<=4?'товара':'товаров'))+'</span></div></div><div class="favorite-seller-products">'+cards+'</div><div class="favorite-seller-share-row">'+shareAction+'</div></section>';
        }).join('');
        target.querySelectorAll('[data-favorite-id]').forEach(function(button){button.onclick=function(event){event.preventDefault();event.stopPropagation();var id=Number(button.getAttribute('data-favorite-id'));button.disabled=true;api('favorite_toggle',{product_id:id,favorite:false}).then(function(result){rows=rows.filter(function(p){return Number(p.id)!==id;});updateFavoritesCount(result.favorites_count);delete cache.favorites;renderRows();}).catch(function(error){button.disabled=false;toast(error);});};});
        bindProductCards(target);
      }
    }
    overlay.querySelector('#favoritesQuery').addEventListener('input',function(){query=this.value||'';renderRows();});
    api('favorites').then(function(data){if(!overlay.isConnected)return;rows=Array.isArray(data)?data:[];updateFavoritesCount(rows.length);renderRows();}).catch(function(error){if(!overlay.isConnected)return;overlay.querySelector('#favoritesResults').innerHTML='<div class="empty"><strong>Не удалось загрузить избранное</strong><p class="tiny">'+esc(friendlyError(error))+'</p></div>';overlay.querySelector('#favoritesResultCount').textContent='Ошибка загрузки';});
  }

  function renderSearch(mode) {
    mode = mode || 'products';
    var html = heading(mode === 'best' ? 'СРАВНЕНИЕ' : 'КАТАЛОГ', 'Поиск товаров', mode === 'best' ? 'Сравните найденные позиции по стоимости.' : 'Ищите по названию, бренду, артикулу или любому фрагменту наименования.');
    html += '<div class="search-toolbar"><div class="search-box"><span>' + iconSvg('search') + '</span><input id="productQuery" placeholder="Например, Dior Sauvage или 100 ml" autocomplete="off"></div><button class="button secondary filter-launch" id="openFilters">' + iconSvg('filter') + '<span>Фильтры</span><b id="filterCount">0</b></button></div><div class="result-bar"><div class="tiny muted" id="resultCount">Загружаем каталог…</div></div><div id="productResults"></div>';
    app.innerHTML = translateHtml(html);
    var sort = 'price_asc';
    var buyerSearch=currentRole==='buyer';var sellerFilterSearch=buyerSearch||currentRole==='admin'||isAdmin;var filters = {brand:'', volume:'', type:'', file_id:'', gender:'', category:'', tester:'', is_set:'', needs_review:'', min_price:'', max_price:'', seller_ids:[]}; if(buyerSearch){delete filters.file_id;delete filters.needs_review;}
    function renderFilterCount() {
      var count=document.getElementById('filterCount');
      if(count)count.textContent=String(activeFilterCount(filters));
    }
    function run() {
      var q = document.getElementById('productQuery').value;
      var payload = {q:q, sort:sort};
      Object.keys(filters).forEach(function(k) { payload[k] = filters[k]; });
      api(mode === 'best' ? 'best_prices' : 'products', payload).then(function(rows) {
        var out = '';
        if (!rows.length) out = '<div class="empty"><div class="symbol">' + iconSvg('search') + '</div><strong>Ничего не найдено</strong><p class="tiny">Измени условия или сбрось часть фильтров.</p></div>';
        rows.forEach(function(p) {
          var itemSub=[localizedProductType(p.type),productMeasureText(p)];if(currentRole!=='buyer'&&p.filename)itemSub.push(p.filename);
          out += productCardMarkup(p, buyerSearch);
        });
        document.getElementById('productResults').innerHTML = translateHtml(out);document.getElementById('productResults').classList.toggle('buyer-product-results',buyerSearch);bindFavoriteButtons(document.getElementById('productResults'));bindProductCards(document.getElementById('productResults'));
        document.getElementById('resultCount').textContent = rows.length + ' позиций в текущей выдаче (максимум 100)';
      }).catch(function(e) { renderGlobalLoadError(e); });
    }
    document.getElementById('productQuery').oninput = function() {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(run, 240);
    };
    document.getElementById('openFilters').onclick = function() {
      openFilterModal(filters, sort, function(next, nextSort) { filters = next; sort = nextSort || sort; renderFilterCount(); run(); });
    };
    renderFilterCount(); run(); return Promise.resolve(html);
  }
  function renderSupport(){return load('support',{},true).then(function(data){var html=heading('МЫ НА СВЯЗИ','Поддержка','Поможем разобраться с обработкой прайсов, подпиской и возможностями приложения.');var developerName=data.developer_username?data.developer_username.replace(/^@/,''):'';var draft=settings.language==='en'?'Hello! I use Basalt Perfume and have a question about: ':settings.language==='kz'?'Сәлеметсіз бе! Basalt Perfume қолданамын, қосымшаға қатысты сұрағым бар: ':'Здравствуйте! Я пользуюсь Basalt Perfume, есть вопрос по работе приложения: ';var developerHref=developerName?'https://t.me/'+encodeURIComponent(developerName)+'?text='+encodeURIComponent(draft):'#';html+='<div class="card"><div class="row"><div><div class="card-title">Связаться с разработчиком</div><div class="tiny muted">Вопросы, идеи и сообщения об ошибках</div></div><div class="setting-icon">'+iconSvg('arrow')+'</div></div><div class="divider"></div><a class="button full telegram-link" id="developerLink" href="'+esc(developerHref)+'" target="_blank" rel="noopener noreferrer">Написать '+(developerName?'@'+esc(developerName):'разработчику')+' '+iconSvg('arrow')+'</a></div><div class="section-head"><h2>Частые вопросы</h2></div><div class="card faq-list-card">'+data.faq.map(function(item,i){return '<div class="faq-item "><div class="faq-q" data-faq="'+i+'">'+esc(item.q)+'<span>'+iconSvg('chevron')+'</span></div><div class="faq-a">'+esc(item.a)+'</div></div>';}).join('')+'</div>';
      app.innerHTML=translateHtml(html);document.querySelectorAll('[data-faq]').forEach(function(b){b.onclick=function(){b.parentNode.classList.toggle('open');};});var developerLink=document.getElementById('developerLink');if(developerLink&&developerLink.getAttribute('href')==='#')developerLink.onclick=function(event){event.preventDefault();toast('Укажите DEVELOPER_USERNAME в конфигурации сайта.');};return html;});}
  function bindAdminKeyRoleDropdown(){var drop=document.getElementById('keyRoleSelect');if(!drop)return;var trigger=drop.querySelector('.custom-select-trigger');if(!trigger)return;trigger.onclick=function(event){event.preventDefault();event.stopPropagation();var open=!drop.classList.contains('open');document.querySelectorAll('[data-select-key],[data-filter-select-key],[data-seller-select]').forEach(function(other){if(other!==drop){other.classList.remove('open');var t=other.querySelector('.custom-select-trigger');if(t)t.setAttribute('aria-expanded','false');}});drop.classList.toggle('open',open);trigger.setAttribute('aria-expanded',open?'true':'false');};drop.querySelectorAll('[data-value]').forEach(function(option){option.onclick=function(event){event.preventDefault();event.stopPropagation();var value=option.getAttribute('data-value')||'buyer';drop.setAttribute('data-selected-value',value);trigger.querySelector('span').textContent=option.getAttribute('data-label')||'Покупатель';drop.querySelectorAll('[data-value]').forEach(function(other){var active=other===option;other.classList.toggle('selected',active);other.setAttribute('aria-selected',active?'true':'false');var check=other.querySelector('.svg-icon');if(check)check.remove();if(active)other.insertAdjacentHTML('beforeend',iconSvg('check'));});drop.classList.remove('open');trigger.setAttribute('aria-expanded','false');};});}
  function renderAdmin() {
    return api('admin_stats').then(function (d) {
      var html = heading('CONTROL ROOM', 'Панель администратора', 'Состояние сервиса и инструменты управления подписками.');
      html += '<div class="stats-grid"><div class="stat-card"><div class="stat-value">' + d.users + '</div><div class="stat-label">Пользователи</div></div><div class="stat-card"><div class="stat-value">' + d.active_subscriptions + '</div><div class="stat-label">Активные подписки</div></div><div class="stat-card"><div class="stat-value">' + d.price_lists + '</div><div class="stat-label">Прайс-листы</div></div><div class="stat-card"><div class="stat-value">' + d.review_rows + '</div><div class="stat-label">Строк на проверку</div></div></div>';
      var maintenance=d.maintenance||{};
      var maintenanceActive=!!maintenance.maintenance_mode;
      html += '<div class="section-head"><h2>Тех. работы</h2><span class="status-label '+(maintenanceActive?'is-maintenance-active':'')+'">'+(maintenanceActive?'Ведутся':'Не назначено')+'</span></div><div class="card admin-maintenance-card"><div class="card-title">'+esc(maintenance.maintenance_title||'Технические работы')+'</div><p class="tiny muted">'+esc(maintenance.maintenance_message||(maintenanceActive?'Доступ для пользователей временно ограничен.':'Пользователи и бот работают в обычном режиме.'))+'</p><div class="tiny muted">'+(maintenanceActive&&maintenance.maintenance_until?'Окончание: '+esc(fmtDateTime(maintenance.maintenance_until)):'')+'</div><div class="admin-maintenance-actions"><button type="button" class="button full" id="openMaintenanceModal">'+(maintenanceActive?'Изменить':'Назначить')+'</button>'+(maintenanceActive?'<button type="button" class="button secondary full" id="stopMaintenance">Завершить</button>':'')+'</div></div>';
      html += '<div class="section-head"><h2>Создать ключи</h2></div><div class="card"><div class="form-row"><label><div class="tiny muted">Количество</div><input class="input" id="keyCount" type="number" min="1" max="100" value="10"></label><label><div class="tiny muted">Срок, дней</div><input class="input" id="keyDays" type="number" min="1" max="3650" value="30"></label></div><div class="key-role-picker"><div class="tiny muted">Роль после активации ключа</div>'+customDropdown('keyRoleSelect','keyRole',[{value:'buyer',label:'Покупатель'},{value:'seller',label:'Продавец'},{value:'admin',label:'Администратор'}],'buyer')+'</div><button class="button full" id="generateKeys">Сгенерировать ключи</button><div id="generatedKeys"></div></div>';
      html += '<div class="section-head"><h2>Опубликовать обновление</h2></div><div class="card"><div class="tiny muted">Сообщение появится в центре уведомлений у пользователей, которые включили уведомления об обновлениях.</div><div style="height:10px"></div><input class="input" id="announcementTitle" placeholder="Заголовок обновления"><div style="height:8px"></div><textarea class="input announcement-body-input" id="announcementBody" rows="4" placeholder="Текст сообщения"></textarea><div style="height:10px"></div><button class="button full" id="publishAnnouncement">Опубликовать</button></div>';

      var keys = d.keys_list || [];
      html += '<div class="section-head"><h2>Ключи активации</h2><span class="status-label section-count">Всего: '+Number(d.keys||keys.length)+'</span></div><div class="card admin-key-list">' + keys.map(function (k, i) {
        var canReveal = !!(k.can_reveal || k.full_key);
        var shownKey = k.full_key || (String(k.key_prefix || 'Ключ') + '–····');
        var unavailable = '';
        if (!canReveal) {
          var reason = k.key_unavailable_reason || 'key_legacy_unrecoverable';
          var note = reason === 'key_decryption_failed'
            ? 'Не удалось расшифровать ключ. Проверьте прежний KEY_ENCRYPTION_SECRET, BOT_TOKEN и пароль БД.'
            : 'Полный ключ не сохранялся для этой старой записи. Восстановить его из хеша нельзя.';
          unavailable = '<div class="tiny muted admin-key-legacy-note">' + esc(note) + '</div>';
        }
        var status = k.used_by_tg_id ? 'Активирован' : 'Свободен';
        return '<div class="admin-key-row" data-admin-key-row="' + Number(k.id) + '">' +
          '<div class="admin-key-actions"><button type="button" class="admin-key-action" data-key-reveal="' + Number(k.id) + '" title="Показать ключ" aria-label="Показать ключ" ' + (canReveal ? '' : 'disabled') + '>' + iconSvg('eye-off') + '</button><button type="button" class="admin-key-action" data-key-copy="' + Number(k.id) + '" title="Копировать ключ" aria-label="Копировать ключ" ' + (canReveal ? '' : 'disabled') + '>' + iconSvg('copy') + '</button></div>' +
          '<div class="admin-key-main"><strong class="admin-key-value ' + (canReveal ? 'is-blurred' : 'is-blurred is-legacy') + '" data-key-value="' + Number(k.id) + '" data-raw-key="' + esc(k.full_key || '') + '" title="' + (canReveal ? 'Нажмите на глаз, чтобы показать ключ' : 'Ключ недоступен для показа') + '">' + esc(shownKey) + '</strong><div class="tiny muted">' + Number(k.duration_days) + ' дн. · ' + status + (k.role_on_activate ? ' · роль: ' + esc(String(k.role_on_activate).toUpperCase()) : '') + '</div>' + unavailable + '</div>' +
          '<span class="status-label">' + (k.usable ? 'Доступен' : 'Использован') + '</span></div>' + (i < keys.length - 1 ? '<div class="divider"></div>' : '');
      }).join('') + '</div>';

      var users = d.users_list || [];
      html += '<div class="section-head"><h2>Пользователи</h2><span class="status-label section-count admin-user-count">Всего: ' + users.length + '</span></div><div class="card admin-users">' + users.map(function (u, i) {
        var photo = avatarMarkup(u, 'admin-user-avatar', '?', false);
        var role = String(u.role || 'none').toLowerCase(); if(!['admin','seller','buyer','none'].includes(role))role='none';
        var fullName=[u.first_name,u.last_name].filter(Boolean).join(' ') || 'Пользователь Telegram';
        return '<button type="button" class="admin-user-row" data-admin-user="' + Number(u.tg_id) + '">' + photo + '<span class="admin-user-info"><strong>' + esc(fullName) + '</strong><small>' + esc(u.username ? '@'+u.username : 'ID '+u.tg_id) + '</small></span><span class="role-badge ' + role + '">' + (role==='admin'?'ADMIN':(role==='buyer'?'BUYER':(role==='none'?'NONE':'SELLER'))) + '</span><span class="tiny muted admin-user-date"><small>Доступ до:</small><strong>' + (u.available_until ? esc(fmtDate(u.available_until)) : 'без подписки') + '</strong></span></button>' + (i < users.length - 1 ? '<div class="divider"></div>' : '');
      }).join('') + '</div>';

      app.innerHTML = translateHtml(html);
      var openMaintenance=document.getElementById('openMaintenanceModal');if(openMaintenance)openMaintenance.onclick=function(){openMaintenanceModal(maintenance);};
      bindAdminKeyRoleDropdown();
      var stopMaintenance=document.getElementById('stopMaintenance');if(stopMaintenance)stopMaintenance.onclick=function(){stopMaintenance.disabled=true;api('save_maintenance',{enabled:false,title:maintenance.maintenance_title||'Технические работы',message:maintenance.maintenance_message||''}).then(function(){toast('Технические работы завершены');delete cache.admin_stats;renderScreen('admin');}).catch(function(err){stopMaintenance.disabled=false;toast(friendlyError(err));});};
      document.getElementById('generateKeys').onclick = function () {
        api('generate_keys', {count:Number(document.getElementById('keyCount').value), days:Number(document.getElementById('keyDays').value), role_on_activate:(document.getElementById('keyRoleSelect').getAttribute('data-selected-value')||'buyer')}).then(function (r) {
          var generatedMarkup = '<div class="generated-keys-result"><div class="divider"></div><div class="tiny muted generated-keys-note">Скопируйте ключи сейчас: полные значения показываются только один раз.</div><textarea class="input keys-output-input" rows="8" id="keysOutput" readonly>' + esc((r.keys || []).join('\n')) + '</textarea><button class="button secondary full" id="copyKeys" style="margin-top:10px">Копировать ключи</button></div>';
          document.getElementById('generatedKeys').innerHTML = translateHtml(generatedMarkup);
          document.getElementById('copyKeys').onclick = function () {
            var output = document.getElementById('keysOutput');
            copyText(output.value).then(function () { toast('Ключи скопированы'); }).catch(function () { output.focus(); output.select(); var copied = false; try { copied = document.execCommand('copy'); } catch (e) {} toast(copied ? 'Ключи скопированы' : 'Не удалось скопировать ключи. Выделите их и скопируйте вручную.'); });
          };
          toast('Создано ключей: ' + r.count);
        }).catch(function (e) { toast(e); });
      };
      document.getElementById('publishAnnouncement').onclick = function () {
        var publishButton=document.getElementById('publishAnnouncement');if(!publishButton||publishButton.disabled)return;
        var titleInput=document.getElementById('announcementTitle'),bodyInput=document.getElementById('announcementBody');
        if(!titleInput.value.trim()||!bodyInput.value.trim()){toast('Заполните заголовок и текст обновления');return;}
        publishButton.disabled=true;publishButton.setAttribute('aria-busy','true');publishButton.textContent='Публикуем…';
        api('create_announcement', {title:titleInput.value, message:bodyInput.value}).then(function (r) {
          toast('Опубликовано: '+Number(r.recipients||0)+' уведомлений. Telegram: '+Number(r.telegram_queued||0)+' в очереди.');
          titleInput.value = ''; bodyInput.value = '';
        }).catch(function (e) { toast(e); }).finally(function(){if(publishButton.isConnected){publishButton.disabled=false;publishButton.removeAttribute('aria-busy');publishButton.textContent='Опубликовать';}});
      };
      overlayKeyActions();
      bindAdminUserRows();
      return html;
    }).catch(function (e) {
      renderGlobalLoadError(e);
    });
  }
  function openMaintenanceModal(state){
    state=state||{};var old=document.getElementById('maintenanceOverlay');if(old)old.remove();
    var overlay=document.createElement('div');overlay.id='maintenanceOverlay';overlay.className='modal-backdrop';
    function pad(n){return String(n).padStart(2,'0');}
    function localValue(date){return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+'T'+pad(date.getHours())+':'+pad(date.getMinutes());}
    var initial=new Date(Date.now()+2*60*60*1000);initial.setSeconds(0,0);
    if(state.maintenance_until){var saved=new Date(String(state.maintenance_until).replace(' ','T'));if(!isNaN(saved.getTime())&&saved.getTime()>Date.now())initial=saved;}
    var remainingInitial=Math.max(60,Math.floor((initial.getTime()-Date.now())/1000));
    var initialDays=Math.floor(remainingInitial/86400),initialHours=Math.floor((remainingInitial%86400)/3600),initialMinutes=Math.floor((remainingInitial%3600)/60);
    var calDate=new Date(initial.getFullYear(),initial.getMonth(),1),selectedDate=new Date(initial.getFullYear(),initial.getMonth(),initial.getDate());
    var hours=initial.getHours(),minutes=initial.getMinutes(),clockMode='hours',mode='keyboard';
    overlay.innerHTML='<section class="filter-modal modal-filter maintenance-modal" role="dialog" aria-modal="true" aria-labelledby="maintenanceTitle"><div class="modal-grab"><span></span></div><div class="modal-content"><div class="eyebrow">УПРАВЛЕНИЕ ДОСТУПОМ</div><h2 id="maintenanceTitle">Технические работы</h2><p class="tiny muted">Пока режим активен, обычные пользователи не смогут работать в WebApp и боте. Администраторам доступ останется.</p><label class="filter-field"><span>Заголовок</span><input class="input" id="maintenanceHeading" maxlength="190" placeholder="Например, обновление каталога" value="'+esc(state.maintenance_title||'Технические работы')+'"></label><label class="filter-field"><span>Подробное описание</span><textarea class="input" id="maintenanceMessage" rows="4" maxlength="4000" placeholder="Что обновляется и почему сервис временно недоступен">'+esc(state.maintenance_message||'')+'</textarea></label><div class="section-head"><h3>Длительность</h3></div><div class="filter-tabs ban-mode-tabs maintenance-mode-tabs" data-active-tab="filters"><button type="button" class="filter-tab active" data-maint-mode="keyboard">Клавиатура</button><button type="button" class="filter-tab" data-maint-mode="analog">Аналог</button></div><section data-maint-panel="keyboard"><div class="ban-duration-grid"><label class="filter-field"><span>Минуты</span><input class="input" id="maintenanceMinutes" type="number" min="0" max="525600" value="'+initialMinutes+'"></label><label class="filter-field"><span>Часы</span><input class="input" id="maintenanceHours" type="number" min="0" max="8760" value="'+initialHours+'"></label><label class="filter-field"><span>Дни</span><input class="input" id="maintenanceDays" type="number" min="0" max="3650" value="'+initialDays+'"></label></div></section><section data-maint-panel="analog" hidden><div class="ban-calendar-clock has-date"><div class="ban-calendar"><div class="ban-cal-head"><button type="button" class="mini-button" data-maint-cal-prev aria-label="Предыдущий месяц"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button><strong data-maint-cal-label></strong><button type="button" class="mini-button" data-maint-cal-next aria-label="Следующий месяц"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button></div><div class="ban-cal-week"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div><div class="ban-cal-grid" data-maint-calendar-grid></div></div><div class="ban-clock-panel"><div class="ban-clock-mode" data-clock-active="hours" data-maint-clock-active="hours"><button type="button" class="active" data-maint-clock-mode="hours">Часы</button><button type="button" data-maint-clock-mode="minutes">Минуты</button></div><div class="ban-clock" data-maint-clock tabindex="0" aria-label="Выбор времени окончания"><div class="ban-clock-numbers" data-maint-clock-numbers></div><div class="ban-clock-hand hour-hand" data-maint-clock-hand="hours"></div><div class="ban-clock-hand minute-hand" data-maint-clock-hand="minutes"></div><div class="ban-clock-center"></div></div><div class="ban-clock-time" data-maint-clock-time></div></div></div></section><div class="ban-summary" id="maintenanceSummary"></div></div><div class="modal-actions"><button type="button" class="button secondary" data-maint-close>Отмена</button><button type="button" class="button" id="saveMaintenance">Назначить</button></div></section>';
    document.body.appendChild(overlay);var modal=overlay.querySelector('.maintenance-modal');bindSheetDrag(overlay,modal);
    function close(){if(!overlay.isConnected)return;overlay.classList.add('closing');setTimeout(function(){if(overlay.isConnected)overlay.remove();},220);document.removeEventListener('keydown',onKey);}
    function onKey(e){if(e.key==='Escape')close();}document.addEventListener('keydown',onKey);overlay.querySelectorAll('[data-maint-close]').forEach(function(b){b.onclick=close;});overlay.addEventListener('click',function(e){if(e.target===overlay)close();});
    function selectedUntil(){return selectedDate?new Date(selectedDate.getFullYear(),selectedDate.getMonth(),selectedDate.getDate(),hours,minutes,0,0):null;}
    function getUntil(){if(mode==='analog')return selectedUntil();var total=Math.max(0,Number(modal.querySelector('#maintenanceMinutes').value||0)*60+Number(modal.querySelector('#maintenanceHours').value||0)*3600+Number(modal.querySelector('#maintenanceDays').value||0)*86400);return total>0?new Date(Date.now()+total*1000):null;}
    function updateSummary(){var d=getUntil(),el=modal.querySelector('#maintenanceSummary');if(!d||isNaN(d.getTime())){el.textContent='Укажите срок окончания технических работ.';return;}var remaining=d.getTime()-Date.now();if(remaining<=0){el.textContent='Время окончания должно быть в будущем.';return;}el.textContent='Технические работы завершатся '+d.toLocaleString(localeTag(),{dateStyle:'medium',timeStyle:'short'})+'.';}
    function renderCalendar(){var y=calDate.getFullYear(),m=calDate.getMonth();var monthLabel=calDate.toLocaleDateString(localeTag(),{month:'long'});monthLabel=monthLabel.charAt(0).toLocaleUpperCase(localeTag())+monthLabel.slice(1);modal.querySelector('[data-maint-cal-label]').textContent=monthLabel+', '+y;var first=new Date(y,m,1),offset=(first.getDay()+6)%7,total=new Date(y,m+1,0).getDate(),grid='';for(var i=0;i<offset;i++)grid+='<span class="ban-cal-blank"></span>';for(var day=1;day<=total;day++){var active=selectedDate&&selectedDate.getFullYear()===y&&selectedDate.getMonth()===m&&selectedDate.getDate()===day;var now=new Date(),past=new Date(y,m,day,23,59)<new Date(now.getFullYear(),now.getMonth(),now.getDate());grid+='<button type="button" data-maint-cal-day="'+day+'" class="ban-cal-day '+(active?'selected ':'')+(past?'past':'')+'" '+(past?'disabled':'')+'>'+day+'</button>';}modal.querySelector('[data-maint-calendar-grid]').innerHTML=grid;modal.querySelectorAll('[data-maint-cal-day]').forEach(function(b){b.onclick=function(){selectedDate=new Date(y,m,Number(b.getAttribute('data-maint-cal-day')));renderCalendar();updateSummary();};});}
    function renderClock(){var numbers=modal.querySelector('[data-maint-clock-numbers]');numbers.innerHTML='';for(var i=0;i<12;i++){var val=clockMode==='hours'?i*2:i*5,angle=i/12*Math.PI*2-Math.PI/2,x=50+38*Math.cos(angle),y=50+38*Math.sin(angle),button=document.createElement('button');button.type='button';button.className='ban-clock-number';button.style.left=x+'%';button.style.top=y+'%';button.textContent=pad(val);button.setAttribute('data-maint-clock-value',String(val));button.onclick=function(){applyClockValue(Number(this.getAttribute('data-maint-clock-value')));};numbers.appendChild(button);}modal.querySelector('[data-maint-clock-hand="hours"]').style.transform='translateX(-50%) rotate('+((hours%24)/24*360)+'deg)';modal.querySelector('[data-maint-clock-hand="minutes"]').style.transform='translateX(-50%) rotate('+(minutes/60*360)+'deg)';modal.querySelector('[data-maint-clock-time]').textContent=pad(hours)+':'+pad(minutes);}
    function applyClockValue(value){if(clockMode==='hours')hours=Math.max(0,Math.min(23,value));else minutes=value%60;renderClock();updateSummary();}
    modal.querySelectorAll('[data-maint-clock-mode]').forEach(function(button){button.onclick=function(){clockMode=button.getAttribute('data-maint-clock-mode');modal.querySelector('[data-maint-clock-active]').setAttribute('data-maint-clock-active',clockMode);modal.querySelector('[data-maint-clock-active]').setAttribute('data-clock-active',clockMode);modal.querySelectorAll('[data-maint-clock-mode]').forEach(function(other){other.classList.toggle('active',other===button);});renderClock();};});
    var face=modal.querySelector('[data-maint-clock]');face.addEventListener('pointerdown',function(event){event.preventDefault();var rect=face.getBoundingClientRect();function move(ev){var x=ev.clientX-rect.left-rect.width/2,y=ev.clientY-rect.top-rect.height/2,deg=(Math.atan2(y,x)*180/Math.PI+90+360)%360;if(clockMode==='hours')hours=Math.round(deg/15)%24;else minutes=Math.round(deg/6)%60;renderClock();updateSummary();}move(event);function end(){document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',end);}document.addEventListener('pointermove',move);document.addEventListener('pointerup',end);document.addEventListener('pointercancel',end);});
    modal.querySelector('[data-maint-cal-prev]').onclick=function(){calDate.setMonth(calDate.getMonth()-1);renderCalendar();};modal.querySelector('[data-maint-cal-next]').onclick=function(){calDate.setMonth(calDate.getMonth()+1);renderCalendar();};
    modal.querySelectorAll('[data-maint-mode]').forEach(function(button){button.onclick=function(){mode=button.getAttribute('data-maint-mode');modal.querySelector('.maintenance-mode-tabs').setAttribute('data-active-tab',mode==='analog'?'sort':'filters');modal.querySelectorAll('[data-maint-mode]').forEach(function(other){other.classList.toggle('active',other===button);});modal.querySelectorAll('[data-maint-panel]').forEach(function(panel){panel.hidden=panel.getAttribute('data-maint-panel')!==mode;});updateSummary();};});
    modal.querySelectorAll('#maintenanceMinutes,#maintenanceHours,#maintenanceDays').forEach(function(el){el.addEventListener('input',updateSummary);});
    modal.querySelector('#saveMaintenance').onclick=function(){var title=modal.querySelector('#maintenanceHeading').value.trim(),message=modal.querySelector('#maintenanceMessage').value.trim(),until=getUntil();if(!title||!message){toast('Заполните заголовок и подробное описание');return;}if(!until||isNaN(until.getTime())||until.getTime()<=Date.now()){toast('Выберите длительность и время окончания в будущем');return;}var save=modal.querySelector('#saveMaintenance');save.disabled=true;api('save_maintenance',{enabled:true,title:title,message:message,until:localValue(until)}).then(function(){toast('Технические работы назначены');delete cache.admin_stats;close();renderScreen('admin');}).catch(function(err){save.disabled=false;toast(friendlyError(err));});};
    renderCalendar();renderClock();updateSummary();setTimeout(function(){if(overlay.isConnected)overlay.classList.add('is-open');},10);
  }
  function bindAdminUserRows() {
    document.querySelectorAll('[data-admin-user]').forEach(function (button) {
      button.onclick = function () { openAdminUserModal(Number(button.getAttribute('data-admin-user'))); };
    });
  }
  function openAdminUserModal(userId) {
    var old=document.getElementById('adminUserOverlay');if(old)old.remove();
    var wait=document.createElement('div');wait.id='adminUserOverlay';wait.className='modal-backdrop';wait.innerHTML='<section class="filter-modal admin-user-modal"><div class="modal-grab"><span></span></div><div class="modal-content"><div class="loading-card"><div class="spinner"></div>Загружаем пользователя…</div></div></section>';document.body.appendChild(wait);wait.addEventListener('error',function(e){var img=e.target;if(!img||img.tagName!=='IMG'||!img.classList.contains('avatar-image'))return;var shell=img.closest('.avatar-shell');if(shell){shell.classList.remove('has-photo','is-loaded');}img.remove();},true);bindSheetDrag(wait,wait.querySelector('.admin-user-modal'));wait.addEventListener('click',function(e){if(e.target===wait){wait.classList.add('closing');setTimeout(function(){if(wait.isConnected)wait.remove();},240);}});setTimeout(function(){if(wait.isConnected)wait.classList.add('is-open');},10);
    api('admin_user_details',{user_id:userId}).then(function(data){
      if(!wait.isConnected)return;var u=data.user||{},sub=data.subscription||null;
      var role=['admin','seller','buyer','none'].includes(String(u.role))?String(u.role):'none';
      var isTargetAdmin=!!u.is_admin||role==='admin';
      var photo=avatarMarkup(u,'admin-modal-avatar','?',true);var name=u.full_name||[u.first_name,u.last_name].filter(Boolean).join(' ')||'Пользователь Telegram';
      var subActive=!!(sub&&sub.active);var subscriptionHtml='<div class="admin-user-subscription"><div class="tiny muted">Подписка</div><strong class="'+(subActive?'sub-active':'sub-inactive')+'">'+(subActive?'Активна':'Не активна')+'</strong><div class="tiny muted">'+(sub&&sub.available_until?'Доступ до '+esc(fmtDateTime(sub.available_until)):'Нет активного срока')+'</div>'+(sub&&sub.is_frozen?'<div class="tiny muted">Подписка заморожена</div>':'')+'</div>';
      var extensionHtml='';
      if(subActive&&!isTargetAdmin){extensionHtml='<section class="admin-sub-extension"><div class="section-head"><h3>Продлить срок подписки</h3></div><div class="admin-sub-extension-row"><label class="filter-field"><span>Добавить</span><input class="input" id="adminExtendAmount" type="number" min="1" max="3650" step="1" value="1"></label><div class="admin-sub-extension-units" role="group" aria-label="Единица продления" data-extension-unit="days"><button type="button" data-extension-unit-value="hours">Часы</button><button type="button" class="active" data-extension-unit-value="days">Дни</button><button type="button" data-extension-unit-value="months">Месяцы</button></div></div><div class="tiny muted admin-sub-extension-summary" id="adminExtendSummary"></div><button type="button" class="button full" id="adminExtendSubscription">Продлить подписку</button></section>';}
      var banned=Number(u.is_blocked)===1&&(!u.banned_until||new Date(String(u.banned_until).replace(' ','T'))>new Date());
      var dateValue=banned&&u.banned_until?String(u.banned_until).replace(' ','T').slice(0,16):'';
      var availableKeys=Array.isArray(data.available_keys)?data.available_keys:(Array.isArray(u.available_keys)?u.available_keys:[]);
      var userLists=Array.isArray(data.price_lists)?data.price_lists:(Array.isArray(u.price_lists)?u.price_lists:[]);
      var readyUserLists=userLists.filter(function(f){return String(f.status)==='ready';});
      var userFavorites=Array.isArray(data.favorites)?data.favorites:(Array.isArray(u.favorites)?u.favorites:[]);
      var userFavoritesHtml='<section class="admin-user-favorites-section"><div class="section-head"><h3>Избранное пользователя</h3><span class="status-label section-count">Всего: '+userFavorites.length+'</span></div>'+(userFavorites.length?'<div class="admin-user-favorites-list">'+userFavorites.map(function(f){var meta=[productMeasureText(f),localizedProductType(f.type),f.filename||''].filter(Boolean);if(f.seller_name||f.seller_username)meta.push('Продавец: '+(f.seller_name||('@'+String(f.seller_username).replace(/^@/,''))));else if(f.seller_tg_id)meta.push('Продавец: ID '+f.seller_tg_id);var price=Number(f.price_usd!==undefined?f.price_usd:(f.effective_price||0));return '<article class="product-card admin-user-favorite-card"><div class="product-card-info"><div class="product-name">'+esc(f.brand?f.brand+' — ':'')+esc(f.name||'Товар')+'</div><div class="product-sub">'+esc(meta.join(' · ')||'Параметры не указаны')+'</div></div><div class="product-price-wrap"><div class="product-price">'+esc(fmtMoney(price,f.currency))+'</div></div></article>';}).join('')+'</div>':'<div class="empty"><strong>Избранное пока пусто</strong><p class="tiny">Добавленные пользователем товары появятся здесь.</p></div>')+'</section>';
      var keyOptions=[{value:'',label:availableKeys.length?'Выберите свободный ключ':'Нет свободных ключей'}].concat(availableKeys.map(function(k){return {value:String(Number(k.id)),label:(k.key_prefix||('Ключ #'+k.id))+' · '+Number(k.duration_days||0)+' дн.'};}));
      var assignmentHtml=!isTargetAdmin?'<section class="admin-user-key-section"><div class="section-head"><h3>Ключ подписки</h3></div><div class="tiny muted">Текущий ключ: '+esc(sub&&sub.key_prefix?sub.key_prefix:'не назначен')+'. Выбор нового ключа завершит предыдущую активную подписку.</div><div class="admin-key-assign-row">'+customDropdown('adminAssignKey','admin-key-assignment',keyOptions,'')+'<button type="button" class="button" id="adminAssignKeyButton" '+(!availableKeys.length?'disabled':'')+'>Назначить</button></div></section>':'';
      var priceListsHtml='<section class="admin-user-files-section"><div class="section-head"><h3>Прайс-листы пользователя</h3><span class="status-label section-count">Всего: '+userLists.length+'</span></div>'+(userLists.length?'<div class="file-list admin-user-file-list">'+userLists.map(function(f){var ready=String(f.status)==='ready';return '<article class="file-card"><div class="file-icon excel-file-icon">'+excelIconSvg()+'</div><div class="file-info"><div class="file-name">'+esc(f.filename||('Прайс-лист #'+f.id))+'</div><div class="file-meta">'+Number(f.product_count||0)+' товаров · '+esc(fmtDate(f.imported_at))+'</div><div class="file-meta">'+(ready?'Обработан':esc(fileStatusLabel(f.status)))+'</div></div><div class="file-actions">'+(ready?'<button type="button" class="mini-button" data-admin-download-file="'+Number(f.id)+'">Скачать</button>':'')+'<button type="button" class="mini-button" data-admin-delete-file="'+Number(f.id)+'">Удалить</button></div></article>';}).join('')+'</div>':'<div class="empty"><strong>Прайс-листов пока нет</strong><p class="tiny">Файлы этого пользователя появятся здесь после загрузки через бота.</p></div>')+(readyUserLists.length?'<div class="download-all-wrap"><button type="button" class="button full" data-admin-download-all>Скачать все ('+readyUserLists.length+')</button></div>':'')+'</section>';
      wait.innerHTML='<section class="filter-modal admin-user-modal" role="dialog" aria-modal="true" aria-labelledby="adminUserTitle"><div class="modal-grab"><span></span></div><div class="modal-content"><div class="admin-user-profile"><div class="admin-user-avatar-row">'+photo+'</div><div class="admin-user-name-row"><h2 id="adminUserTitle" class="admin-user-display-name">'+esc(name)+'</h2><a class="admin-user-telegram-link" href="'+esc(u.username?'https://t.me/'+encodeURIComponent(String(u.username).replace(/^@/,'')):'tg://user?id='+Number(u.tg_id))+'" target="_blank" rel="noopener noreferrer" aria-label="Открыть пользователя в Telegram" title="Открыть в Telegram"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.74 4.27 18.5 19.54c-.24 1.08-.88 1.35-1.78.84l-4.92-3.63-2.37 2.28c-.26.26-.48.48-.98.48l.35-5.01 9.12-8.24c.4-.35-.09-.55-.62-.2L6.02 13.14l-4.82-1.51c-1.05-.33-1.07-1.05.22-1.55L20.26 2.7c.87-.32 1.63.21 1.48 1.57Z"/></svg></a></div><div class="tiny muted">'+esc(u.username?'@'+u.username:'Без username')+' · ID '+Number(u.tg_id)+'</div></div>'+subscriptionHtml+extensionHtml+assignmentHtml+priceListsHtml+userFavoritesHtml+'<div class="filter-field admin-role-field"><span>Роль пользователя</span>'+customDropdown('adminUserRole','admin-user-role',[{value:'none',label:'Без роли'},{value:'buyer',label:'Покупатель'},{value:'seller',label:'Продавец'},{value:'admin',label:'Администратор'}],role)+'</div><div class="admin-role-actions"><button class="button full" id="saveUserRole">Сохранить роль</button><div class="tiny muted admin-role-lock-note" hidden>Роль администратора нельзя менять.</div></div><div class="admin-ban-status '+(banned?'is-banned':'')+'">'+(banned?'Пользователь заблокирован'+(u.banned_until?' до '+esc(fmtDateTime(u.banned_until)):' бессрочно'):'Пользователь не заблокирован')+'</div><details class="admin-ban-details" '+(banned?'open':'')+'><summary>Блокировка пользователя</summary><div class="admin-ban-form"><label class="filter-field"><span>Причина блокировки</span><input class="input" id="banReason" maxlength="500" placeholder="Например, нарушение правил" value="'+esc(u.ban_reason||'')+'"></label><label class="filter-field"><span>Подробности и дополнительная информация</span><textarea class="input" id="banDetails" rows="4" placeholder="Внутренние заметки, обстоятельства, уточнения">'+esc(u.ban_details||'')+'</textarea></label><label class="admin-permanent"><input type="checkbox" id="banPermanent"><span class="seller-filter-checkbox" aria-hidden="true"></span><span class="admin-permanent-label">Бессрочная блокировка</span></label><div class="admin-ban-schedule" data-ban-schedule><div class="filter-tabs ban-mode-tabs" data-active-tab="filters"><button class="filter-tab active" type="button" data-ban-mode="keyboard">Клавиатура</button><button class="filter-tab" type="button" data-ban-mode="calendar">Аналог</button></div><section data-ban-panel="keyboard"><div class="ban-duration-grid"><label class="filter-field"><span>Минуты</span><input class="input" id="banMinutes" type="number" min="0" max="525600" value="0"></label><label class="filter-field"><span>Часы</span><input class="input" id="banHours" type="number" min="0" max="8760" value="1"></label><label class="filter-field"><span>Дни</span><input class="input" id="banDays" type="number" min="0" max="3650" value="0"></label></div></section><section data-ban-panel="calendar" hidden><div class="ban-calendar-clock"><div class="ban-calendar"><div class="ban-cal-head"><button type="button" class="mini-button" data-cal-prev aria-label="Предыдущий месяц"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button><strong data-cal-label></strong><button type="button" class="mini-button" data-cal-next aria-label="Следующий месяц"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button></div><div class="ban-cal-week"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div><div class="ban-cal-grid" data-calendar-grid></div></div><div class="ban-clock-panel"><div class="ban-clock-mode" data-clock-active="hours"><button type="button" class="active" data-clock-mode="hours">Часы</button><button type="button" data-clock-mode="minutes">Минуты</button></div><div class="ban-clock" data-ban-clock><div class="ban-clock-numbers" data-clock-numbers></div><div class="ban-clock-hand hour-hand" data-clock-hand="hours"></div><div class="ban-clock-hand minute-hand" data-clock-hand="minutes"></div><div class="ban-clock-center"></div></div><div class="ban-clock-time" data-clock-time>12:00</div></div></div></section></div><div class="ban-summary" data-ban-summary>Будет рассчитано после выбора срока.</div><div class="form-row admin-ban-actions"><button class="button secondary" type="button" id="clearUserBan" '+(!banned?'hidden':'')+'>Снять блокировку</button><button class="button" type="button" id="saveUserChanges">Сохранить и заблокировать</button></div></div></details></div></section>';
      var modal=wait.querySelector('.admin-user-modal');if(isTargetAdmin)modal.classList.add('is-readonly-admin');
      if(!isTargetAdmin){var deleteZone=document.createElement('section');deleteZone.className='admin-user-delete-zone';deleteZone.innerHTML='<button type="button" class="button secondary full" id="startAdminUserDelete">Удалить пользователя</button><div class="admin-user-delete-confirm" hidden><button type="button" class="button danger full" id="confirmAdminUserDelete" disabled>Удалить (5)</button><button type="button" class="button secondary full" id="cancelAdminUserDelete">Отмена</button><p class="tiny muted">Удаление необратимо: будут удалены профиль, товары, прайс-листы, ключи и сохранённые данные пользователя.</p></div>';modal.querySelector('.modal-content').appendChild(deleteZone);var startDelete=deleteZone.querySelector('#startAdminUserDelete'),confirmDelete=deleteZone.querySelector('#confirmAdminUserDelete'),cancelDelete=deleteZone.querySelector('#cancelAdminUserDelete'),confirmBox=deleteZone.querySelector('.admin-user-delete-confirm'),deleteTimer=null,deleteLeft=5;function resetDeleteConfirm(){if(deleteTimer){clearInterval(deleteTimer);deleteTimer=null;}deleteLeft=5;startDelete.hidden=false;confirmBox.hidden=true;confirmDelete.disabled=true;confirmDelete.classList.remove('is-ready');confirmDelete.textContent='Удалить (5)';}startDelete.onclick=function(){startDelete.hidden=true;confirmBox.hidden=false;deleteLeft=5;confirmDelete.disabled=true;confirmDelete.classList.remove('is-ready');confirmDelete.textContent='Удалить (5)';deleteTimer=window.setInterval(function(){if(!wait.isConnected){clearInterval(deleteTimer);deleteTimer=null;return;}deleteLeft--;if(deleteLeft<=0){clearInterval(deleteTimer);deleteTimer=null;confirmDelete.disabled=false;confirmDelete.textContent='Удалить';confirmDelete.classList.add('is-ready');}else confirmDelete.textContent='Удалить ('+deleteLeft+')';},1000);};cancelDelete.onclick=resetDeleteConfirm;confirmDelete.onclick=function(){if(confirmDelete.disabled)return;confirmDelete.disabled=true;cancelDelete.disabled=true;confirmDelete.textContent='Удаление…';api('admin_delete_user',{user_id:Number(userId)}).then(function(){if(deleteTimer)clearInterval(deleteTimer);toast('Пользователь удалён');delete cache.admin_stats;delete cache.overview;wait.remove();renderScreen('admin');}).catch(function(err){cancelDelete.disabled=false;resetDeleteConfirm();toast(friendlyError(err));});};}
      bindSheetDrag(wait,modal);
      var assignKeyDrop=modal.querySelector('#adminAssignKey');if(assignKeyDrop){var assignKeyTrigger=assignKeyDrop.querySelector('.custom-select-trigger');assignKeyTrigger.onclick=function(event){event.preventDefault();event.stopPropagation();var opening=!assignKeyDrop.classList.contains('open');document.querySelectorAll('[data-select-key],[data-filter-select-key],[data-seller-select]').forEach(function(drop){if(drop!==assignKeyDrop){drop.classList.remove('open');var t=drop.querySelector('.custom-select-trigger');if(t)t.setAttribute('aria-expanded','false');}});assignKeyDrop.classList.toggle('open',opening);assignKeyTrigger.setAttribute('aria-expanded',opening?'true':'false');};assignKeyDrop.querySelectorAll('[data-value]').forEach(function(option){option.onclick=function(event){event.preventDefault();event.stopPropagation();var value=option.getAttribute('data-value')||'';assignKeyDrop.setAttribute('data-selected-value',value);assignKeyTrigger.querySelector('span').textContent=option.getAttribute('data-label')||'Выберите свободный ключ';assignKeyDrop.querySelectorAll('[data-value]').forEach(function(other){var active=other===option;other.classList.toggle('selected',active);other.setAttribute('aria-selected',active?'true':'false');var check=other.querySelector('.svg-icon');if(check)check.remove();if(active)other.insertAdjacentHTML('beforeend',iconSvg('check'));});assignKeyDrop.classList.remove('open');assignKeyTrigger.setAttribute('aria-expanded','false');};});}
      var assignKeyButton=modal.querySelector('#adminAssignKeyButton');if(assignKeyButton)assignKeyButton.onclick=function(){var keyId=Number(modal.querySelector('#adminAssignKey').getAttribute('data-selected-value')||0);if(!keyId){toast('Выберите свободный ключ');return;}assignKeyButton.disabled=true;api('admin_change_user_key',{user_id:Number(userId),key_id:keyId}).then(function(){var message=translateHtml('Подписка активирована');if(sub&&sub.active)message+='\n\n'+translateHtml('Предыдущая активная подписка деактивирована.');window.alert(message);delete cache.admin_stats;wait.remove();openAdminUserModal(userId);}).catch(function(err){assignKeyButton.disabled=false;window.alert(translateHtml('Подписка не активирована')+'\n\n'+friendlyError(err));});};
      var extendButton=modal.querySelector('#adminExtendSubscription');
      if(extendButton){
        var extendUnit='days';var extendAmount=modal.querySelector('#adminExtendAmount');var extendSummary=modal.querySelector('#adminExtendSummary');
        function parseUntil(value){var dt=new Date(String(value||'').replace(' ','T'));return isNaN(dt.getTime())?new Date():dt;}
        function extendedDate(){var dt=parseUntil(sub&&sub.available_until);var amount=Math.max(1,Number(extendAmount.value||1));if(extendUnit==='hours')dt.setHours(dt.getHours()+amount);else if(extendUnit==='months')dt.setMonth(dt.getMonth()+amount);else dt.setDate(dt.getDate()+amount);return {date:dt,amount:amount};}
        function updateExtensionSummary(){var result=extendedDate();var word=extendUnit==='hours'?'ч.':(extendUnit==='months'?'мес.':'дн.');extendSummary.textContent='Будет добавлено: '+result.amount+' '+word+'. Новый срок: '+result.date.toLocaleString(localeTag(),{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})+'.';}
        extendAmount.addEventListener('input',updateExtensionSummary);
        modal.querySelectorAll('[data-extension-unit-value]').forEach(function(b){b.onclick=function(){extendUnit=b.getAttribute('data-extension-unit-value')||'days';var units=modal.querySelector('.admin-sub-extension-units');if(units)units.setAttribute('data-extension-unit',extendUnit);modal.querySelectorAll('[data-extension-unit-value]').forEach(function(other){other.classList.toggle('active',other===b);});extendAmount.max=extendUnit==='hours'?'8760':(extendUnit==='months'?'120':'3650');updateExtensionSummary();};});
        extendButton.onclick=function(){var amount=Math.floor(Number(extendAmount.value||0));if(!Number.isFinite(amount)||amount<1){toast('Укажите срок продления больше нуля');return;}extendButton.disabled=true;api('admin_extend_user_subscription',{user_id:Number(userId),amount:amount,unit:extendUnit}).then(function(){toast('Срок подписки продлён');delete cache.admin_stats;wait.remove();openAdminUserModal(userId);}).catch(function(err){extendButton.disabled=false;toast(friendlyError(err));});};
        updateExtensionSummary();
      }
      modal.querySelectorAll('[data-admin-download-file]').forEach(function(button){button.onclick=function(){openBotLink('admin_download_'+Number(userId)+'_'+Number(button.getAttribute('data-admin-download-file')));};});
      var downloadAllAdmin=modal.querySelector('[data-admin-download-all]');if(downloadAllAdmin)downloadAllAdmin.onclick=function(){openBotLink('admin_download_all_'+Number(userId));};
      modal.querySelectorAll('[data-admin-delete-file]').forEach(function(button){button.onclick=function(){var fileId=Number(button.getAttribute('data-admin-delete-file'));if(!window.confirm('Удалить этот прайс-лист и его товары из каталога?'))return;button.disabled=true;api('delete_file',{file_id:fileId,user_id:Number(userId)}).then(function(){toast('Прайс-лист удалён');delete cache.admin_stats;wait.remove();openAdminUserModal(userId);}).catch(function(err){button.disabled=false;toast(friendlyError(err));});};});
      var telegramButton=modal.querySelector('[data-admin-user-telegram]');if(telegramButton)telegramButton.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();var targetUsername=String(telegramButton.getAttribute('data-username')||'').replace(/^@/,'').trim();var targetId=String(telegramButton.getAttribute('data-user-id')||'').trim();if(targetUsername){if(!openTelegramUrl('https://t.me/'+encodeURIComponent(targetUsername)))toast('Не удалось открыть профиль в Telegram.');return;}if(targetId){var deepLink='tg://user?id='+encodeURIComponent(targetId);var launched=false;try{if(tg&&typeof tg.openLink==='function'){tg.openLink(deepLink);launched=true;}}catch(openError){}if(!launched){try{window.location.href=deepLink;launched=true;}catch(navError){}}if(!launched)toast('У пользователя нет публичного username. Открытие по ID зависит от поддержки Telegram на устройстве.');}});var banDetails=modal.querySelector('.admin-ban-details');if(isTargetAdmin){var roleSave=modal.querySelector('#saveUserRole');if(roleSave)roleSave.hidden=true;var lockNote=modal.querySelector('.admin-role-lock-note');if(lockNote)lockNote.hidden=false;var roleBox=modal.querySelector('#adminUserRole');if(roleBox){roleBox.classList.add('is-disabled');roleBox.setAttribute('aria-disabled','true');roleBox.inert=true;}if(banDetails){banDetails.inert=true;banDetails.setAttribute('aria-disabled','true');banDetails.classList.add('is-disabled');banDetails.open=false;}}if(banDetails){var banSummary=banDetails.querySelector('summary'),banForm=banDetails.querySelector('.admin-ban-form');banSummary.addEventListener('click',function(ev){ev.preventDefault();var opening=!banDetails.open;if(opening){banDetails.open=true;banForm.animate([{opacity:0,transform:'translateY(-8px)',maxHeight:'0px'},{opacity:1,transform:'translateY(0)',maxHeight:banForm.scrollHeight+'px'}],{duration:260,easing:'cubic-bezier(.2,.8,.2,1)'});}else{var anim=banForm.animate([{opacity:1,transform:'translateY(0)',maxHeight:banForm.scrollHeight+'px'},{opacity:0,transform:'translateY(-6px)',maxHeight:'0px'}],{duration:210,easing:'cubic-bezier(.4,0,.8,.2)'});anim.onfinish=function(){banDetails.open=false;};}});}var calDate=new Date();calDate.setDate(1);var selectedDate=new Date();selectedDate.setHours(12,0,0,0);var clockMode='hours', hours=12, minutes=0, banMode='keyboard';
      function close(){wait.classList.add('closing');setTimeout(function(){wait.remove();},220);document.removeEventListener('keydown',escClose);}
      function escClose(e){if(e.key==='Escape')close();}document.addEventListener('keydown',escClose);wait.addEventListener('click',function(e){if(e.target===wait)close();});
      var roleDrop=modal.querySelector('#adminUserRole'),roleTrigger=roleDrop.querySelector('.custom-select-trigger');
      roleTrigger.onclick=function(e){if(isTargetAdmin){e.preventDefault();e.stopPropagation();return;}e.stopPropagation();var opening=!roleDrop.classList.contains('open');document.querySelectorAll('[data-select-key],[data-filter-select-key]').forEach(function(d){if(d!==roleDrop){d.classList.remove('open');var t=d.querySelector('.custom-select-trigger');if(t)t.setAttribute('aria-expanded','false');}});roleDrop.classList.toggle('open',opening);roleTrigger.setAttribute('aria-expanded',opening?'true':'false');};
      roleDrop.querySelectorAll('[data-value]').forEach(function(option){option.onclick=function(e){if(isTargetAdmin){e.preventDefault();e.stopPropagation();return;}e.stopPropagation();var next=option.getAttribute('data-value');roleDrop.setAttribute('data-selected-value',next);roleTrigger.querySelector('span').textContent=option.getAttribute('data-label');roleDrop.querySelectorAll('[data-value]').forEach(function(other){var active=other===option;other.classList.toggle('selected',active);other.setAttribute('aria-selected',active?'true':'false');var check=other.querySelector('.svg-icon');if(check)check.remove();if(active)other.insertAdjacentHTML('beforeend',iconSvg('check'));});roleDrop.classList.remove('open');roleTrigger.setAttribute('aria-expanded','false');};});
      bindSheetDrag(wait,modal);
      function fmtDateTime(v){if(!v)return '—';var d=new Date(String(v).replace(' ','T'));return isNaN(d.getTime())?String(v):d.toLocaleString(localeTag(),{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});}
      function selectedUntil(){if(!selectedDate)return null;var d=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),selectedDate.getDate(),hours,minutes,0,0);return d;}
      function durationText(seconds){if(seconds<=0)return 'менее минуты';var days=Math.floor(seconds/86400),hrs=Math.floor((seconds%86400)/3600),mins=Math.floor((seconds%3600)/60);var out=[];if(days)out.push(days+' дн.');if(hrs)out.push(hrs+' ч.');if(mins||!out.length)out.push(mins+' мин.');return out.join(' ');}
      function updateSummary(){var summary=modal.querySelector('[data-ban-summary]'),permanent=modal.querySelector('#banPermanent').checked;if(permanent){summary.textContent='Бессрочно — дата автоматической разблокировки не назначается.';return;}if(banMode==='calendar'){var d=selectedUntil();if(!d){summary.textContent='Выберите дату в календаре и время разблокировки.';return;}var seconds=Math.floor((d.getTime()-Date.now())/1000);summary.textContent=seconds>0?'Блокировка на '+durationText(seconds)+'. Разблокировка: '+d.toLocaleString(localeTag(),{dateStyle:'medium',timeStyle:'short'})+'.':'Выбранное время уже прошло — задайте будущее время.';}else{var sec=Math.max(0,Number(modal.querySelector('#banMinutes').value||0)*60+Number(modal.querySelector('#banHours').value||0)*3600+Number(modal.querySelector('#banDays').value||0)*86400);summary.textContent=sec>=60?'Блокировка на '+durationText(sec)+'. Разблокировка: '+new Date(Date.now()+sec*1000).toLocaleString(localeTag(),{dateStyle:'medium',timeStyle:'short'})+'.':'Укажите длительность не менее одной минуты.';}}
      function renderCalendar(){var y=calDate.getFullYear(),m=calDate.getMonth();modal.querySelector('[data-cal-label]').textContent=calDate.toLocaleDateString(localeTag(),{month:'long',year:'numeric'});var first=new Date(y,m,1),offset=(first.getDay()+6)%7,total=new Date(y,m+1,0).getDate(),grid='';for(var i=0;i<offset;i++)grid+='<span class="ban-cal-blank"></span>';for(var day=1;day<=total;day++){var active=selectedDate&&selectedDate.getFullYear()===y&&selectedDate.getMonth()===m&&selectedDate.getDate()===day;var today=new Date();var isPast=new Date(y,m,day,23,59)<new Date(today.getFullYear(),today.getMonth(),today.getDate());grid+='<button type="button" data-cal-day="'+day+'" class="ban-cal-day '+(active?'selected ':'')+(isPast?'past':'')+'" '+(isPast?'disabled':'')+'>'+day+'</button>';}modal.querySelector('[data-calendar-grid]').innerHTML=grid;modal.querySelectorAll('[data-cal-day]').forEach(function(b){b.onclick=function(){var day=Number(b.getAttribute('data-cal-day'));selectedDate=new Date(y,m,day);modal.querySelector('.ban-calendar-clock').classList.remove('has-date');modal.querySelector('.ban-clock-panel').hidden=false;renderCalendar();renderClock();updateSummary();};});}
      function renderClock(){var face=modal.querySelector('[data-ban-clock]'),numbers=modal.querySelector('[data-clock-numbers]');numbers.innerHTML='';var count=12;for(var i=0;i<count;i++){var val=clockMode==='hours'?(i*2):(i*5);var angle=(i/count)*Math.PI*2-Math.PI/2;var x=50+38*Math.cos(angle),y=50+38*Math.sin(angle);var span=document.createElement('button');span.type='button';span.className='ban-clock-number';span.style.left=x+'%';span.style.top=y+'%';span.textContent=String(val).padStart(2,'0');span.setAttribute('data-clock-value',String(val));span.onclick=function(){applyClockValue(Number(this.getAttribute('data-clock-value')));};numbers.appendChild(span);}var hourAngle=((hours%24)/24)*360,minuteAngle=(minutes/60)*360;modal.querySelector('[data-clock-hand="hours"]').style.transform='translateX(-50%) rotate('+hourAngle+'deg)';modal.querySelector('[data-clock-hand="minutes"]').style.transform='translateX(-50%) rotate('+minuteAngle+'deg)';modal.querySelector('[data-clock-time]').textContent=String(hours).padStart(2,'0')+':'+String(minutes).padStart(2,'0');}
      function applyClockValue(v){if(clockMode==='hours')hours=Math.max(0,Math.min(23,v));else minutes=v%60;renderClock();updateSummary();}
      modal.querySelectorAll('[data-clock-mode]').forEach(function(b){b.onclick=function(){clockMode=b.getAttribute('data-clock-mode');modal.querySelector('.ban-clock-mode').setAttribute('data-clock-active',clockMode);modal.querySelectorAll('[data-clock-mode]').forEach(function(x){x.classList.toggle('active',x===b);});renderClock();};});
      var face=modal.querySelector('[data-ban-clock]');face.addEventListener('pointerdown',function(e){var rect=face.getBoundingClientRect();function move(ev){var x=ev.clientX-rect.left-rect.width/2,y=ev.clientY-rect.top-rect.height/2;var deg=(Math.atan2(y,x)*180/Math.PI+90+360)%360;if(clockMode==='hours'){var v=Math.round(deg/15)%24;hours=v;}else minutes=(Math.round(deg/6)%60);renderClock();updateSummary();}move(e);function end(){document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end);}document.addEventListener('pointermove',move);document.addEventListener('pointerup',end);});
      modal.querySelector('[data-cal-prev]').onclick=function(){calDate.setMonth(calDate.getMonth()-1);renderCalendar();};modal.querySelector('[data-cal-next]').onclick=function(){calDate.setMonth(calDate.getMonth()+1);renderCalendar();};
      function syncBanModeVisibility(){var permanent=modal.querySelector('#banPermanent').checked;var schedule=modal.querySelector('[data-ban-schedule]');if(schedule){schedule.classList.toggle('is-collapsed',permanent);schedule.setAttribute('aria-hidden',permanent?'true':'false');schedule.inert=permanent;}modal.querySelectorAll('[data-ban-panel]').forEach(function(panel){panel.hidden=panel.getAttribute('data-ban-panel')!==banMode;});var checkbox=modal.querySelector('#banPermanent'),label=modal.querySelector('.admin-permanent'),visual=modal.querySelector('.admin-permanent .seller-filter-checkbox');if(label)label.classList.toggle('selected',!!checkbox.checked);if(visual){visual.innerHTML=checkbox.checked?'<i class="seller-filter-dot"></i>':'';visual.classList.remove('check-pop');if(checkbox.checked){void visual.offsetWidth;visual.classList.add('check-pop');}}}
      modal.querySelectorAll('[data-ban-mode]').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-ban-mode')===banMode);b.onclick=function(){banMode=b.getAttribute('data-ban-mode');modal.querySelector('.ban-mode-tabs').setAttribute('data-active-tab',banMode==='calendar'?'sort':'filters');modal.querySelectorAll('[data-ban-mode]').forEach(function(x){x.classList.toggle('active',x===b);});syncBanModeVisibility();updateSummary();};});
      ['banMinutes','banHours','banDays'].forEach(function(id){modal.querySelector('#'+id).addEventListener('input',updateSummary);});modal.querySelector('#banPermanent').onchange=function(){syncBanModeVisibility();updateSummary();};syncBanModeVisibility();
      modal.querySelector('#clearUserBan').onclick=function(){if(isTargetAdmin)return;api('admin_update_user',{user_id:userId,role:modal.querySelector('#adminUserRole').getAttribute('data-selected-value'),clear_ban:true}).then(function(){toast('Блокировка снята');delete cache.admin_stats;close();renderScreen('admin');}).catch(function(e){toast(friendlyError(e));});};
      function saveRoleOnly(){if(isTargetAdmin)return;var roleValue=modal.querySelector('#adminUserRole').getAttribute('data-selected-value');api('admin_update_user',{user_id:userId,role:roleValue}).then(function(){toast('Роль сохранена');delete cache.admin_stats;close();renderScreen('admin');}).catch(function(e){toast(friendlyError(e));});}
      modal.querySelector('#saveUserRole').onclick=saveRoleOnly;
      modal.querySelector('#saveUserChanges').onclick=function(){if(isTargetAdmin)return;var reason=modal.querySelector('#banReason').value.trim();if(!reason){toast('Укажите причину блокировки');return;}var payload={user_id:userId,role:modal.querySelector('#adminUserRole').getAttribute('data-selected-value'),ban:true,permanent:modal.querySelector('#banPermanent').checked,ban_reason:reason,ban_details:modal.querySelector('#banDetails').value};if(!payload.permanent){if(banMode==='calendar'){var selected=selectedUntil();if(!selected||selected.getTime()<=Date.now()){toast('Выберите время в будущем');return;}function pad(n){return String(n).padStart(2,'0');}payload.banned_until=selected.getFullYear()+'-'+pad(selected.getMonth()+1)+'-'+pad(selected.getDate())+'T'+pad(selected.getHours())+':'+pad(selected.getMinutes());}else{payload.minutes=Math.max(0,Number(modal.querySelector('#banMinutes').value||0));payload.hours=Math.max(0,Number(modal.querySelector('#banHours').value||0));payload.days=Math.max(0,Number(modal.querySelector('#banDays').value||0));if(payload.minutes+payload.hours+payload.days===0){toast('Укажите срок блокировки');return;}}}var save=modal.querySelector('#saveUserChanges');save.disabled=true;api('admin_update_user',payload).then(function(){toast('Изменения пользователя сохранены');delete cache.admin_stats;close();renderScreen('admin');}).catch(function(e){save.disabled=false;toast(friendlyError(e));});};
      renderCalendar();renderClock();updateSummary();setTimeout(function(){wait.classList.add('is-open');},10);
    }).catch(function(e){wait.remove();toast(friendlyError(e));});
  }
  function fmtDateTime(v){if(!v)return '—';var d=new Date(String(v).replace(' ','T'));return isNaN(d.getTime())?String(v):d.toLocaleString(localeTag(),{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});}
  function copyText(text) {
    function legacyCopy() {
      return new Promise(function (resolve, reject) {
        var field = document.createElement('textarea');
        field.value = String(text); field.setAttribute('readonly', 'readonly');
        field.style.position = 'fixed'; field.style.left = '0'; field.style.top = '0'; field.style.width = '2px'; field.style.height = '2px'; field.style.opacity = '0.02'; field.style.pointerEvents = 'auto'; field.style.zIndex = '2147483647';
        document.body.appendChild(field); field.focus({preventScroll:true}); field.select(); field.setSelectionRange(0, field.value.length);
        var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        field.remove(); ok ? resolve() : reject(new Error('copy_failed'));
      });
    }
    if (navigator.clipboard && window.isSecureContext && navigator.clipboard.writeText) return navigator.clipboard.writeText(String(text)).catch(legacyCopy);
    return legacyCopy();
  }
  function loadAdminKey(keyId, value) {
    var existing = value ? value.getAttribute('data-raw-key') : '';
    if (existing) return Promise.resolve(existing);
    return api('reveal_subscription_key', {key_id:Number(keyId)}).then(function (result) {
      var raw = String(result && result.full_key || '');
      if (!raw) throw new Error('key_decryption_failed');
      if (value) {
        value.setAttribute('data-raw-key', raw);
        value.textContent = raw;
      }
      return raw;
    });
  }
  function overlayKeyActions() {
    document.querySelectorAll('[data-key-reveal]').forEach(function (button) {
      button.onclick = function () {
        var keyId = button.getAttribute('data-key-reveal');
        var value = document.querySelector('[data-key-value="' + keyId + '"]');
        if (!value) return;
        loadAdminKey(keyId, value).then(function () {
          var revealed = value.classList.contains('is-blurred');
          value.classList.toggle('is-revealed', revealed);
          value.classList.toggle('is-blurred', !revealed);
          button.innerHTML = iconSvg(revealed ? 'eye' : 'eye-off');
          var label = translateHtml(revealed ? 'Скрыть ключ' : 'Показать ключ');
          button.setAttribute('title', label); button.setAttribute('aria-label', label);
        }).catch(function (error) { toast(error); });
      };
    });
    document.querySelectorAll('[data-key-copy]').forEach(function (button) {
      button.onclick = function () {
        var keyId = button.getAttribute('data-key-copy');
        var value = document.querySelector('[data-key-value="' + keyId + '"]');
        if (!value) return;
        var alreadyLoadedKey = value.getAttribute('data-raw-key') || '';
        // Most visible keys were decrypted by admin_stats already. Start clipboard access
        // directly inside the click handler so WebViews don't drop the transient user gesture.
        var copyPromise = alreadyLoadedKey
          ? copyText(alreadyLoadedKey)
          : loadAdminKey(keyId, value).then(function (raw) { return copyText(raw); });
        copyPromise.then(function () { toast('Ключ скопирован'); }).catch(function (error) {
          if (error && error.code) toast(error);
          else toast('Не удалось скопировать ключ. Попробуйте выделить его вручную.');
        });
      };
    });
  }
  function renderSubscriptionGate(state){
    state=state||subscriptionGateState||{};
    var navEl=document.getElementById('bottomNav');if(navEl)navEl.hidden=true;
    var sub=state.subscription||null;var active=!!(sub&&sub.active);var ever=!!state.hasEverActivated;
    var title=active&&state.role==='none'?'Доступ пока не настроен':(ever?'Продлите подписку':'Купите подписку');
    var message=active&&state.role==='none'
      ?'Для вашего аккаунта ещё не назначена роль. Обратитесь к администратору, чтобы получить доступ.'
      :(ever?'Вы уже активировали ключ ранее, но срок доступа закончился. Продлите подписку в Telegram-боте, чтобы продолжить работу.':'Для начала работы активируйте ключ подписки в Telegram-боте. После активации здесь появится ваш каталог.');
    var buttonLabel=active&&state.role==='none'?'Открыть чат с ботом':(ever?'Продлить подписку в Telegram':'Купить подписку в Telegram');
    var href=botUrl('subscribe')||('https://t.me/'+encodeURIComponent(botUsername));
    var html=heading('ДОСТУП К BASALT','Подписка требуется','Каталог и остальные разделы станут доступны после активации подписки.');
    html+='<section class="empty global-server-error subscription-required-page"><div class="symbol">'+iconSvg('subscription')+'</div><strong>'+esc(title)+'</strong><p class="tiny">'+esc(message)+'</p><a class="button full telegram-link" href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">'+esc(buttonLabel)+' '+iconSvg('arrow')+'</a></section>';
    app.innerHTML=translateHtml(html);app.classList.remove('screen-loading');app.style.minHeight='';
  }
  function virtualProfileKey(){return 'test_'+String(previewRole||'none');}
  function renderVirtualScreen(screen){
    var role=String(previewRole||'none'),profileKey=virtualProfileKey();
    var titles={admin:'Администратор',seller:'Продавец',buyer:'Покупатель',none:'Без роли'};
    var roleTitle=titles[role]||'Без роли';
    var navEl=document.getElementById('bottomNav');if(navEl)navEl.hidden=(role==='none');
    app.inert=false;app.classList.remove('virtual-preview-page');
    if(previewScenario==='maintenance'){
      renderSystemLock('maintenance',{title:'Тестовые технические работы',message:'Это демонстрация того, что видит пользователь во время технических работ. Запросы и действия недоступны.',until:'18 октября 2026, 12:00'});
      var lockRetry=document.getElementById('systemLockRetry');if(lockRetry){lockRetry.textContent='Режим предпросмотра';lockRetry.disabled=true;}
      app.classList.add('virtual-preview-page');addPreviewReturnButton('bottom');return;
    }
    if(previewScenario==='banned'){
      renderSystemLock('ban',{reason:'Это демонстрация заблокированного аккаунта. Действия и разделы недоступны.',until:'18 октября 2026, 12:00'});
      var banRetry=document.getElementById('systemLockRetry');if(banRetry){banRetry.textContent='Режим предпросмотра';banRetry.disabled=true;}
      app.classList.add('virtual-preview-page');addPreviewReturnButton('bottom');return;
    }
    var html='';
    if(role==='none'){
      html=heading('ВИРТУАЛЬНЫЙ ПРОФИЛЬ','Подписка требуется','Демонстрация экрана без назначенной роли.');
      html+='<section class="empty global-server-error subscription-required-page"><div class="symbol">'+iconSvg('subscription')+'</div><strong>Покупка или продление подписки</strong><p class="tiny">Профиль <b>'+esc(profileKey)+'</b> предназначен для пользователей без доступа. После назначения роли и активации подписки здесь появятся разделы приложения.</p><a class="button full telegram-link" href="#">Перейти к подписке '+iconSvg('arrow')+'</a></section>';
      app.innerHTML=translateHtml(html);app.classList.add('virtual-preview-page');app.inert=false;addPreviewReturnButton('bottom');return;
    }

    var headingTitle=screen==='home'?'Парфюмерный центр':(screen==='prices'?'Прайс-листы':(screen==='search'||screen==='best'?'Поиск товаров':(screen==='subscription'?'Ваша подписка':(screen==='settings'?'Настройки':(screen==='notifications'?'Центр уведомлений':(screen==='admin'?'Панель администратора':'Поддержка'))))));
    var subtitles={admin:'Визуальный просмотр интерфейса администратора.',seller:'Обработка прайс-листов и управление каталогом.',buyer:'Поиск парфюмерии и сравнение цен.',none:'Доступ к приложению не назначен.'};
    html=heading('ВИЗУАЛЬНЫЙ РЕЖИМ',headingTitle,subtitles[role]+' Данные демонстрационные, действия отключены.');
    html+='<div class="card virtual-profile-banner"><div class="tiny muted">ВИРТУАЛЬНЫЙ АККАУНТ</div><strong>'+esc(profileKey)+'</strong><span class="role-badge '+esc(role)+'">'+esc(roleTitle.toUpperCase())+'</span><span class="status-label"><i class="dot"></i> Только просмотр</span></div>';

    if(screen==='prices'){
      html+='<div class="row virtual-list-heading"><div><div class="card-title">Обработанные прайс-листы</div><div class="tiny muted">Последние файлы · демонстрационные данные</div></div><span class="status-label">Всего: 8</span></div><div class="file-list virtual-file-list">';
      [['dior-price.xlsx','Dior · 248 позиций','Обработан сегодня, 12:42'],['chanel_catalog.xlsx','Chanel · 186 позиций','Обработан сегодня, 10:18'],['ysl_october.xlsx','Yves Saint Laurent · 312 позиций','Обработан вчера, 18:06'],['versace-list.csv','Versace · 94 позиции','Обработан вчера, 15:31']].forEach(function(f,i){html+='<div class="file-card"><div class="file-icon">XLS</div><div class="file-info"><div class="file-name">'+esc(f[0])+'</div><div class="file-meta">'+esc(f[1])+'</div><div class="file-meta">'+esc(f[2])+'</div></div><span class="status-label">Готов</span></div>';});
      html+='</div><section class="empty virtual-placeholder"><div class="symbol">'+iconSvg('file')+'</div><strong>Тут будут обработанные прайс-листы</strong><p class="tiny">Список выше показан для демонстрации внешнего вида интерфейса.</p></section>';
    }else if(screen==='search'||screen==='best'){
      html+='<div class="search-toolbar"><div class="search-box"><span>'+iconSvg('search')+'</span><input placeholder="Например, Dior Sauvage или 100 ml" disabled></div><button type="button" class="button secondary filter-launch" disabled>'+iconSvg('filter')+'<span>Фильтры</span><b>2</b></button></div><div class="filters"><span class="filter-chip active">Все товары</span><span class="filter-chip">Парфюмерная вода</span><span class="filter-chip">100 мл</span><span class="filter-chip">В наличии</span></div><div class="result-bar"><div class="tiny muted">1 284 позиции в каталоге</div><span class="tiny muted">Сортировка: сначала дешевле</span></div><div class="product-results buyer-product-results">';
      [['Dior Sauvage Eau de Toilette','Мужской · Туалетная вода · 100 мл','86,00 €','Dior'],['Bleu de Chanel Eau de Parfum','Мужской · Парфюмерная вода · 100 мл','113,00 €','Chanel'],['Y Eau de Parfum','Мужской · Парфюмерная вода · 100 мл','94,00 €','Yves Saint Laurent'],['Versace Dylan Blue','Мужской · Туалетная вода · 100 мл','59,00 €','Versace']].forEach(function(prod,i){html+='<article class="product-card buyer-product-card"><div class="product-main"><div class="product-name">'+esc(prod[0])+'</div><div class="product-sub">'+esc(prod[1])+'</div><div class="product-tag"><span class="tag">'+esc(prod[3])+'</span><span class="tag">В наличии</span></div></div><div class="product-price-wrap"><div class="product-price">'+esc(prod[2])+'</div><div class="tiny muted">лучшая цена</div></div></article>';});
      html+='</div>';
    }else if(screen==='subscription'){
      html+='<section class="subscription-card"><div class="row"><span class="subscription-plan">BASALT · PREMIUM ACCESS</span><span class="status-label">Активна</span></div><div class="subscription-status"><span class="status-dot"></span> Все функции доступны</div><div class="subscription-time">6 дней</div><div class="muted tiny">Действует до 21 октября 2026</div><div class="progress" aria-label="Осталось 6 из 7 дней"><span style="width:85.7% !important;--subscription-progress:85.7%;background:#fff;display:block;min-width:2px"></span></div><div class="row tiny muted"><span>Ключ: BP– ···· – ···· – ····</span><span>Доступ открыт</span></div></section>';
      html+='<div class="section-head"><h2>Что включено</h2></div><div class="card"><div class="setting-row"><div class="setting-icon">'+iconSvg('file')+'</div><div class="setting-copy"><strong>Каталог прайс-листов</strong><small>Обработка файлов и единый список товаров</small></div><span class="feature-check">'+iconSvg('check')+'</span></div><div class="divider"></div><div class="setting-row"><div class="setting-icon">'+iconSvg('search')+'</div><div class="setting-copy"><strong>Поиск и сравнение цен</strong><small>Фильтры по бренду, типу и объёму</small></div><span class="feature-check">'+iconSvg('check')+'</span></div><div class="divider"></div><div class="setting-row"><div class="setting-icon">'+iconSvg('bell')+'</div><div class="setting-copy"><strong>Уведомления о сроке</strong><small>Напоминания до окончания подписки</small></div><span class="feature-check">'+iconSvg('check')+'</span></div></div><div class="card"><div class="card-title">Продлить доступ</div><p class="tiny muted">Новый ключ активируется в чате с Telegram-ботом.</p><button type="button" class="button full" disabled>Перейти к активации в Telegram '+iconSvg('arrow')+'</button></div>';
    }else if(screen==='settings'){
      var roleLabel=role==='admin'?'ADMIN':(role==='buyer'?'ПОКУПАТЕЛЬ':'ПРОДАВЕЦ');
      html+='<div class="card profile-settings-card"><div><div class="card-title">Профиль Telegram</div><div class="tiny muted">'+esc(profileKey)+' · тестовый профиль</div><div style="margin-top:9px"><span class="role-badge '+esc(role)+'">'+roleLabel+'</span></div></div><div class="avatar virtual-avatar">'+esc(roleTitle.slice(0,1))+'</div></div>';
      html+='<div class="card"><div class="card-title">Язык интерфейса</div><div class="setting-row"><div class="setting-icon">'+iconSvg('globe')+'</div><div class="setting-copy"><strong>Язык</strong><small>Выберите язык приложения</small></div><select class="select-control" disabled><option>Русский</option></select></div><div class="divider"></div><div class="card-title">Цветовая тема</div><div class="theme-grid">'+[['Mono','#f2f2f2','#141414'],['Ocean','#9cd5f3','#16354a'],['Forest','#a8d6ae','#1c3b25'],['Rose','#efbdcb','#4a202d'],['Amber','#e9cf91','#4a3611']].map(function(t,i){return '<button type="button" class="theme-choice '+(!i?'active':'')+'" disabled><span class="swatch"><i style="background:'+t[1]+'"></i><i style="background:'+t[2]+'"></i></span>'+t[0]+'</button>';}).join('')+'</div><div class="divider"></div><div class="setting-row"><div class="setting-icon">'+iconSvg('settings')+'</div><div class="setting-copy"><strong>Режим отображения</strong><small>Тёмная или светлая тема</small></div><select class="select-control" disabled><option>Тёмный</option></select></div></div>';
      html+='<div class="section-head"><h2>Уведомления</h2></div><div class="card">'+[['Обновления приложения','Новости, новые возможности и изменения'],['Обработанные файлы','Результат загрузки и ошибки распознавания'],['Подписка','Напоминания до окончания доступа']].filter(function(x){return role!=='buyer'||x[0]!=='Обработанные файлы';}).map(function(item,i){return (i?'<div class="divider"></div>':'')+'<div class="setting-row"><div class="setting-icon">'+iconSvg(i===0?'code':(i===1?'file':'subscription'))+'</div><div class="setting-copy"><strong>'+item[0]+'</strong><small>'+item[1]+'</small></div><button type="button" class="toggle '+(i!==1?'on':'')+'" disabled aria-pressed="'+(i!==1?'true':'false')+'"></button></div>';}).join('')+'</div><button class="button full" disabled>Сохранить настройки</button>';
    }else if(screen==='notifications'){
      var notifs=[['Обновление каталога','Добавлены новые позиции и уточнены цены в каталоге.','Сегодня, 12:40','code'],['Подписка скоро закончится','До окончания доступа осталось 6 дней.','Сегодня, 09:00','subscription']];
      if(role!=='buyer')notifs.unshift(['Прайс-лист обработан','Файл dior-price.xlsx успешно добавлен в каталог.','Сегодня, 08:30','file']);
      html+='<div class="card notification-list">'+notifs.map(function(n,i){return '<article class="notification '+(i===0?'unread':'')+'"><div class="notification-icon">'+iconSvg(n[3])+'</div><div><h3>'+n[0]+'</h3><p>'+n[1]+'</p><time>'+n[2]+'</time></div></article>';}).join('')+'</div>';
    }else if(screen==='admin'){
      html+='<div class="stats-grid"><div class="stat-card"><div class="stat-icon">'+iconSvg('user')+'</div><div class="stat-value">128</div><div class="stat-label">Пользователи</div></div><div class="stat-card"><div class="stat-icon">'+iconSvg('subscription')+'</div><div class="stat-value">42</div><div class="stat-label">Активные подписки</div></div><div class="stat-card"><div class="stat-icon">'+iconSvg('file')+'</div><div class="stat-value">86</div><div class="stat-label">Прайс-листы</div></div><div class="stat-card"><div class="stat-icon">'+iconSvg('search')+'</div><div class="stat-value">13</div><div class="stat-label">Строк на проверку</div></div></div>';
      html+='<div class="section-head"><h2>Создать ключи</h2></div><div class="card"><div class="form-row"><label><div class="tiny muted">Количество</div><input class="input" value="10" disabled></label><label><div class="tiny muted">Срок, дней</div><input class="input" value="30" disabled></label></div><div style="height:12px"></div><button class="button full" disabled>Сгенерировать ключи</button></div>';
      html+='<div class="section-head"><h2>Пользователи</h2><span class="tiny muted">Последние аккаунты</span></div><div class="card">'+[['basalt_user','Продавец','Активна'],['aroma_shop','Покупатель','Активна'],['perfume_demo','Без роли','Требуется подписка']].map(function(u,i){return (i?'<div class="divider"></div>':'')+'<div class="setting-row"><div class="avatar virtual-small-avatar">'+u[0].slice(0,1).toUpperCase()+'</div><div class="setting-copy"><strong>'+u[0]+'</strong><small>'+u[1]+' · '+u[2]+'</small></div><button type="button" class="mini-button" disabled>Просмотр</button></div>';}).join('')+'</div>';
      html+='<div class="section-head"><h2>Опубликовать обновление</h2></div><div class="card"><input class="input" placeholder="Заголовок обновления" disabled><div style="height:8px"></div><textarea class="input" rows="3" placeholder="Текст сообщения" disabled></textarea><div style="height:10px"></div><button class="button full" disabled>Опубликовать</button></div>';
    }else if(screen==='support'){
      html+='<div class="card"><div class="row"><div><div class="card-title">Связаться с разработчиком</div><div class="tiny muted">Вопросы, идеи и сообщения об ошибках</div></div><div class="setting-icon">'+iconSvg('arrow')+'</div></div><div class="divider"></div><button class="button full" disabled>Написать разработчику '+iconSvg('arrow')+'</button></div><div class="section-head"><h2>Частые вопросы</h2></div><div class="card"><div class="faq-item"><div class="faq-q">Как загрузить прайс-лист? '+iconSvg('chevron')+'</div><div class="faq-a">Отправьте Excel или CSV документом боту. После обработки результаты появятся в приложении.</div></div><div class="faq-item"><div class="faq-q">Почему часть строк требует проверки? '+iconSvg('chevron')+'</div><div class="faq-a">Неоднозначные названия и цены можно проверить вручную.</div></div><div class="faq-item"><div class="faq-q">Сколько времени обрабатывается один файл?</div><div class="faq-a">Обычно обработка одного файла занимает примерно 3–5 минут. Время зависит от размера прайс-листа и количества строк.</div></div><div class="faq-item"><div class="faq-q">Как обрабатываются конфликтные файлы?</div><div class="faq-a">Если новый прайс-лист конфликтует с уже загруженным (например, это другая версия того же прайса), бот предложит выбрать действие для конфликтующих файлов. Чтобы обновление прошло максимально надёжно и заняло меньше времени, заранее удалите старый конфликтующий прайс-лист на странице «Прайс-листы», а затем загрузите новый.</div></div></div>';
    }else{
      html+='<section class="section-head"><h2>Сводка каталога</h2>'+(role==='buyer'?'<span class="text-link">Подписка '+iconSvg('arrow')+'</span>':'<span class="tiny muted">Демо-данные</span>')+'</section>';
      if(role==='buyer'){
        html+='<div class="stats-grid home-catalog-stats buyer-stats"><div class="stat-card"><div class="stat-icon">'+iconSvg('subscription')+'</div><div class="stat-value">1 284</div><div class="stat-label">Товаров в каталоге</div></div><div class="stat-card"><div class="stat-icon">'+iconSvg('bell')+'</div><div class="stat-value">2</div><div class="stat-label">Новых уведомлений</div></div><div class="stat-card"><div class="stat-icon">'+iconSvg('clock')+'</div><div class="stat-value">6</div><div class="stat-label">Дней осталось</div></div><div class="stat-card favorites-stat-card"><div class="stat-icon">'+favoriteStarSvg(false)+'</div><div class="stat-value">12</div><div class="stat-label">Избранное</div></div></div><div class="section-head"><h2>Быстрый доступ</h2></div><div class="action-grid buyer-action-grid"><div class="action-card buyer-search-wide"><span class="symbol">'+iconSvg('search')+'</span><span><strong>Поиск товаров</strong><small>Фильтры, бренды и сравнение цен</small></span></div><div class="action-card"><span class="symbol">'+iconSvg('bell')+'</span><span><strong>Уведомления</strong><small>Новости и статус подписки</small></span></div><div class="action-card"><span class="symbol">'+iconSvg('arrow')+'</span><span><strong>Поддержка</strong><small>FAQ и связь с разработчиком</small></span></div></div>';
      }else if(role==='seller'){
        html+='<div class="stats-grid home-catalog-stats"><div class="stat-card"><div class="stat-icon">'+iconSvg('file')+'</div><div class="stat-value">8</div><div class="stat-label">Прайс-листов</div></div><div class="stat-card"><div class="stat-icon">'+iconSvg('subscription')+'</div><div class="stat-value">2 440</div><div class="stat-label">Позиций каталога</div></div><div class="stat-card"><div class="stat-icon">'+iconSvg('bell')+'</div><div class="stat-value">3</div><div class="stat-label">Новых уведомлений</div></div><div class="stat-card"><div class="stat-icon">'+iconSvg('clock')+'</div><div class="stat-value">6</div><div class="stat-label">Дней осталось</div></div></div><div class="section-head"><h2>Быстрый доступ</h2></div><div class="action-grid"><div class="action-card"><span class="symbol">'+iconSvg('file')+'</span><span><strong>Прайс-листы</strong><small>Файлы и результаты обработки</small></span></div><div class="action-card"><span class="symbol">'+iconSvg('search')+'</span><span><strong>Поиск товаров</strong><small>Поиск по общему каталогу</small></span></div><div class="action-card"><span class="symbol">'+iconSvg('bell')+'</span><span><strong>Уведомления</strong><small>Новости и статусы</small></span></div></div>';
      }else{
        html+='<div class="stats-grid"><div class="stat-card"><div class="stat-icon">'+iconSvg('user')+'</div><div class="stat-value">128</div><div class="stat-label">Пользователи</div></div><div class="stat-card"><div class="stat-icon">'+iconSvg('subscription')+'</div><div class="stat-value">42</div><div class="stat-label">Активные подписки</div></div><div class="stat-card"><div class="stat-icon">'+iconSvg('file')+'</div><div class="stat-value">86</div><div class="stat-label">Прайс-листы</div></div><div class="stat-card"><div class="stat-icon">'+iconSvg('search')+'</div><div class="stat-value">13</div><div class="stat-label">Строк на проверку</div></div></div><div class="section-head"><h2>Состояние каталога</h2></div><div class="card"><div class="setting-row"><div class="setting-icon">'+iconSvg('check')+'</div><div class="setting-copy"><strong>API каталога</strong><small>Демонстрационный статус: доступен</small></div><span class="status-label">OK</span></div><div class="divider"></div><div class="setting-row"><div class="setting-icon">'+iconSvg('bell')+'</div><div class="setting-copy"><strong>Очередь обработки</strong><small>2 файла ожидают обработки в демо</small></div><span class="status-label">Всего: 2</span></div></div><div class="section-head"><h2>Быстрый доступ</h2></div><div class="action-grid"><div class="action-card"><span class="symbol">'+iconSvg('user')+'</span><span><strong>Пользователи</strong><small>Роли и подписки</small></span></div><div class="action-card"><span class="symbol">'+iconSvg('subscription')+'</span><span><strong>Ключи подписки</strong><small>Генерация и контроль доступа</small></span></div></div>';
      }
    }
    app.innerHTML=translateHtml(html);
    app.classList.add('virtual-preview-page');
    addPreviewReturnButton();
    // Keep the page scrollable. A click-capture guard below blocks actions without
    // making the entire app inert (which also prevents touch/mouse scrolling in WebViews).
    app.inert=false;
  }
  function openVirtualFavoritesModal(){
    var existing=document.getElementById('virtualFavoritesOverlay');if(existing)existing.remove();var overlay=document.createElement('div');overlay.id='virtualFavoritesOverlay';overlay.className='modal-backdrop';
    overlay.innerHTML='<section class="filter-modal modal-filter favorites-modal" role="dialog" aria-modal="true" aria-labelledby="virtualFavoritesTitle"><div class="modal-grab"><span></span></div><div class="modal-content"><div class="row"><div><p class="eyebrow">ВИЗУАЛЬНЫЙ РЕЖИМ</p><h2 id="virtualFavoritesTitle">Избранное</h2></div></div><section class="empty"><div class="symbol">'+favoriteStarSvg(false)+'</div><strong>Тут будут избранные товары</strong><p class="tiny">Список специально пуст в профиле test_buyer.</p></section></div></section>';
    document.body.appendChild(overlay);function closeVirtualFavorites(){if(overlay.isConnected){overlay.classList.add('closing');setTimeout(function(){if(overlay.isConnected)overlay.remove();},220);document.removeEventListener('keydown',onVirtualKey);}}function onVirtualKey(e){if(e.key==='Escape')closeVirtualFavorites();}document.addEventListener('keydown',onVirtualKey);overlay.addEventListener('click',function(e){if(e.target===overlay)closeVirtualFavorites();});bindSheetDrag(overlay,overlay.querySelector('.favorites-modal'));setTimeout(function(){if(overlay.isConnected)overlay.classList.add('is-open');},10);
  }
  function adoptProfileAppearance(source){
    if(!source||typeof source!=='object')return;
    if(['ru','en','kz'].indexOf(String(source.language||''))!==-1)settings.language=String(source.language);
    if(['mono','ocean','forest','rose','amber'].indexOf(String(source.theme||''))!==-1)settings.theme=String(source.theme);
    if(['dark','light'].indexOf(String(source.appearance||''))!==-1)settings.appearance=String(source.appearance);
    savedSettings=Object.assign({},settings);applyTheme();
  }
  function renderSystemLock(kind, detail){
    detail=detail||{};var isBan=kind==='ban'; var title=isBan?'Доступ заблокирован':(detail.title||'Технические работы');
    var message=isBan?(detail.reason||'Доступ к приложению временно ограничен.'):(detail.message||'Сервис временно недоступен.');
    var until=detail.until;
    document.body.classList.add('system-lock-mode');
    var topbar=document.querySelector('.topbar');if(topbar)topbar.hidden=false;
    var bottomNav=document.getElementById('bottomNav');if(bottomNav)bottomNav.hidden=true;
    var previewBadge=document.getElementById('previewBadge');if(previewBadge)previewBadge.hidden=true;
    app.classList.add('system-lock-view');
    app.innerHTML='<section class="system-lock"><div class="system-lock-icon">'+iconSvg(isBan?'lock':'wrench')+'</div><p class="eyebrow">'+(isBan?'ДОСТУП ОГРАНИЧЕН':'BASALT · ТЕХНИЧЕСКИЕ РАБОТЫ')+'</p><h1>'+esc(title)+'</h1><p class="system-lock-message">'+esc(message)+'</p><p class="tiny muted system-lock-until">'+(until?esc((isBan?'Блокировка до: ':'Ожидаемое завершение: ')+String(until)):(isBan?'Блокировка бессрочная':'Срок окончания не указан'))+'</p><button type="button" class="button secondary system-lock-retry" id="systemLockRetry">Проверить снова</button></section>';
    var retry=document.getElementById('systemLockRetry');if(retry)retry.onclick=function(){window.location.reload();};
  }
  function restoreSystemLockShell(){
    document.body.classList.remove('system-lock-mode');app.classList.remove('system-lock-view');
    var topbar=document.querySelector('.topbar');if(topbar)topbar.hidden=false;
    var notifyButton=document.getElementById('notificationsButton');if(notifyButton)notifyButton.hidden=false;
    var bottomNav=document.getElementById('bottomNav');if(bottomNav)bottomNav.hidden=false;
    var previewBadge=document.getElementById('previewBadge');if(previewBadge)previewBadge.hidden=false;
  }
  function checkSystemLock(){return api('overview').then(function(o){var p=o.profile||{},sys=o.system||{};adoptProfileAppearance(p);if(p.ban_active){renderSystemLock('ban',{reason:p.ban_reason,until:p.banned_until});return true;}if(sys.maintenance_mode&&!o.is_admin){renderSystemLock('maintenance',{title:sys.maintenance_title,message:sys.maintenance_message,until:sys.maintenance_until});return true;}return false;}).catch(function(error){renderGlobalLoadError(error);return true;});}
  function refreshSystemLock(){if(document.hidden||!initData||previewModeActive)return;checkSystemLock().then(function(locked){if(!locked&&app.querySelector('.system-lock'))renderScreen(activeScreen||'home');});}
  window.setInterval(refreshSystemLock,30000);document.addEventListener('visibilitychange',function(){if(!document.hidden)refreshSystemLock();});
  function renderScreen(screen){
    if(previewModeActive&&previewRole){renderVirtualScreen(screen);return;}
    if(globalLoadFailure){renderGlobalLoadError(globalLoadFailure);return;}
    checkSystemLock().then(function(locked){if(locked)return;restoreSystemLockShell();if(subscriptionGateState&&!isAdmin){renderSubscriptionGate(subscriptionGateState);return;}if(globalLoadFailure){renderGlobalLoadError(globalLoadFailure);return;}app.classList.add('screen-loading');app.style.minHeight='0';var task;if(screen==='home')task=renderHome();else if(screen==='prices')task=renderPrices();else if(screen==='subscription')task=renderSubscription();else if(screen==='settings')task=renderSettings();else if(screen==='notifications')task=renderNotifications();else if(screen==='search')task=renderSearch('products');else if(screen==='best')task=renderSearch('best');else if(screen==='support')task=renderSupport();else if(screen==='admin')task=renderAdmin();else task=renderHome();Promise.resolve(task).then(function(){app.classList.remove('screen-loading');app.style.minHeight='';app.classList.remove('screen-enter');void app.offsetWidth;app.classList.add('screen-enter');if(activeScreen===screen)resetPageScroll();}).catch(function(error){renderGlobalLoadError(error);});}).catch(function(error){renderGlobalLoadError(error);});}
  document.addEventListener('click',function(e){if(!e.target.closest('[data-select-key],[data-filter-select-key],[data-seller-select]'))document.querySelectorAll('[data-select-key],[data-filter-select-key],[data-seller-select]').forEach(function(drop){drop.classList.remove('open');var trigger=drop.querySelector('.custom-select-trigger');if(trigger)trigger.setAttribute('aria-expanded','false');});});
  // Telegram buttons remain ordinary anchor links. Avoid intercepting clicks: WebView clients
  // differ in how openTelegramLink handles user/profile links and may swallow the navigation.
  document.getElementById('bottomNav').addEventListener('click',function(e){var b=e.target.closest('button[data-screen]');if(b)nav(b.getAttribute('data-screen'));});
  app.addEventListener('load', function (e) {
    var img = e.target;
    if (img && img.tagName === 'IMG' && img.classList.contains('avatar-image') && img.parentNode) img.parentNode.classList.add('is-loaded');
  }, true);
  app.addEventListener('error', function (e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.classList.contains('avatar-image')) return;
    // Leave the immediate initials fallback in place instead of showing a broken-image glyph.
    if (img.parentNode) { img.parentNode.classList.remove('is-loaded'); img.parentNode.classList.remove('has-photo'); }
    img.remove();
  }, true);
  app.addEventListener('click',function(e){var b=e.target.closest('[data-go]');if(b){var dest=b.getAttribute('data-go');if(dest==='boost'){openPriceBoostModal();return;}nav(dest);}});
  document.getElementById('notificationsButton').onclick=function(){nav('notifications');};
  var markAllReadButton=document.getElementById('markAllReadButton');if(markAllReadButton)markAllReadButton.onclick=function(){if(markAllReadButton.disabled)return;markAllReadButton.disabled=true;api('mark_all_read',{}).then(function(result){delete cache.notifications;delete cache.overview;var dot=document.getElementById('unreadDot');if(dot)dot.classList.remove('on');toast('Прочитано уведомлений: '+Number(result.updated||0));renderScreen('notifications');}).catch(function(error){markAllReadButton.disabled=false;toast(error);});};
  document.addEventListener('contextmenu',function(e){if(e.target&&e.target.closest&&e.target.closest('img,canvas'))e.preventDefault();});
  if(window.BasaltEffects&&window.BasaltEffects.initOrbField)window.BasaltEffects.initOrbField();
  // Telegram destinations remain normal anchors (target=_blank); this avoids WebView interception issues.
  if(!initData){
    document.body.classList.add('external-open');
    var topbar=document.querySelector('.topbar'); if(topbar)topbar.hidden=true;
    var bottomNav=document.getElementById('bottomNav'); if(bottomNav)bottomNav.hidden=true;
    var previewBadge=document.getElementById('previewBadge'); if(previewBadge)previewBadge.hidden=true;
    app.className='external-open-screen';
    var browserLang=(navigator.language||'ru').toLowerCase();var defaultLandingLang=browserLang.indexOf('en')===0?'en':(browserLang.indexOf('kk')===0||browserLang.indexOf('kz')===0?'kz':'ru');
    var publicBot=String(window.BASALT_BOT_USERNAME||'').replace(/^@/,'').trim();
    var landingBotHref=publicBot?'https://t.me/'+encodeURIComponent(publicBot)+'?start=webapp':'https://t.me/';
    app.innerHTML='<section class="external-telegram-card" aria-labelledby="externalTelegramTitle"><div class="external-brand"><span class="external-brand-mark\"><img class="brand-logo" src="assets/img/logo.svg?v=1" alt="Basalt" width="44px" height="44px"></span><span><strong>BASALT</strong><small>PERFUME CENTER</small></span></div><div class="external-landing-copy" data-landing-copy="ru"><p class="external-eyebrow">TELEGRAM WEB APP</p><h1 id="externalTelegramTitle">Откройте Basalt Perfume в Telegram</h1><p>Для безопасной авторизации и доступа к каталогу откройте приложение кнопкой WebApp в чате с ботом. Обычный браузер не передаёт данные авторизации Telegram.</p><a class="button full telegram-link" href="'+esc(landingBotHref)+'" target="_blank" rel="noopener noreferrer">Открыть в Telegram '+iconSvg('arrow')+'</a></div><div class="external-landing-copy" data-landing-copy="en" hidden><p class="external-eyebrow">TELEGRAM WEB APP</p><h1>Open Basalt Perfume in Telegram</h1><p>For secure sign-in and access to your catalogue, open the app using the WebApp button in the bot chat. A regular browser does not provide Telegram authentication data.</p><a class="button full telegram-link" href="'+esc(landingBotHref)+'" target="_blank" rel="noopener noreferrer">Open in Telegram '+iconSvg('arrow')+'</a></div><div class="external-landing-copy" data-landing-copy="kz" hidden><p class="external-eyebrow">TELEGRAM WEB APP</p><h1>Basalt Perfume қолданбасын Telegram ішінде ашыңыз</h1><p>Қауіпсіз кіру және каталогқа қол жеткізу үшін бот чатындағы WebApp батырмасын пайдаланыңыз. Кәдімгі браузер Telegram авторизация деректерін бермейді.</p><a class="button full telegram-link" href="'+esc(landingBotHref)+'" target="_blank" rel="noopener noreferrer">Telegram ішінде ашу '+iconSvg('arrow')+'</a></div><div class="external-language-switch" role="group" aria-label="Language / Язык"><button type="button" data-landing-lang="ru">RU</button><button type="button" data-landing-lang="en">EN</button><button type="button" data-landing-lang="kz">KZ</button></div><p class="external-footer" data-landing-footer>Личный каталог · Авторизация через Telegram</p></section>';
    document.documentElement.classList.remove('external-open-pending');
    var landingFooterText={ru:'Личный каталог · Авторизация через Telegram',en:'Private catalogue · Telegram authentication',kz:'Жеке каталог · Telegram авторизациясы'};
    var landingLanguageSwitch=document.querySelector('.external-language-switch');if(landingLanguageSwitch)landingLanguageSwitch.setAttribute('data-active-lang',defaultLandingLang);document.querySelectorAll('[data-landing-lang]').forEach(function(button){button.classList.toggle('active',button.getAttribute('data-landing-lang')===defaultLandingLang);button.setAttribute('aria-pressed',button.getAttribute('data-landing-lang')===defaultLandingLang?'true':'false');button.onclick=function(){var lang=button.getAttribute('data-landing-lang');document.querySelectorAll('[data-landing-lang]').forEach(function(other){var active=other===button;other.classList.toggle('active',active);other.setAttribute('aria-pressed',active?'true':'false');});if(landingLanguageSwitch)landingLanguageSwitch.setAttribute('data-active-lang',lang);document.querySelectorAll('[data-landing-copy]').forEach(function(copy){copy.hidden=copy.getAttribute('data-landing-copy')!==lang;});var footer=document.querySelector('[data-landing-footer]');if(footer)footer.textContent=landingFooterText[lang]||landingFooterText.ru;document.documentElement.lang=lang;};});
    var initialLangButton=document.querySelector('[data-landing-lang="'+defaultLandingLang+'"]'); if(initialLangButton)initialLangButton.click();
    return;
  }
  document.documentElement.classList.remove('external-open-pending');
  api('overview').then(function(o){overview=o;useBootOverviewOnce=true;profile=o.profile;adoptProfileAppearance(profile);isAdmin=!!o.is_admin;currentRole=o.role||o.profile.role||(isAdmin?'admin':'none');currentPriceMultiplier=Number(o.profile.price_multiplier||1);botUsername=o.bot_username||botUsername;configureRoleNavigation();if(profile&&profile.ban_active){renderSystemLock('ban',{reason:profile.ban_reason,until:profile.banned_until});return null;}if(o.system&&o.system.maintenance_mode&&!isAdmin){renderSystemLock('maintenance',{title:o.system.maintenance_title,message:o.system.maintenance_message,until:o.system.maintenance_until});return null;}if(previewMode&&!o.is_admin){throw new Error('admin_required');}if(!isAdmin&&(currentRole==='none'||!o.subscription||!o.subscription.active)){subscriptionGateState={role:currentRole,subscription:o.subscription||null,hasEverActivated:!!o.has_ever_activated_subscription};renderSubscriptionGate(subscriptionGateState);return null;}subscriptionGateState=null;var bottomNav=document.getElementById('bottomNav');if(bottomNav)bottomNav.hidden=false;if(profile&&!/^\/?uploads\/avatars\/[a-f0-9]{64}\.(?:jpg|png|webp)$/i.test(String(profile.photo_url||'')))api('cache_avatar').catch(function(){});return api('settings');}).then(function(s){if(!s)return;settings=s||settings;savedSettings=Object.assign({},settings);applyTheme();if(previewMode&&isAdmin){renderPreviewRolePicker();return;}return renderHome();}).catch(function(e){renderGlobalLoadError(e);});
})();
