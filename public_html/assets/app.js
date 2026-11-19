(function () {
  'use strict';

  // Preserve native browser zoom and desktop accessibility controls.
  // Do not intercept Ctrl/Meta+wheel or multi-touch zoom.
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
  function fallbackBrowserUiMode(){
    if(initData)return 'telegram-webapp';
    var ua=String(navigator.userAgent||'');
    var mobileUa=/Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Windows Phone/i.test(ua);
    var ipadOs=navigator.platform==='MacIntel'&&Number(navigator.maxTouchPoints)>1;
    var compactTouch=!!(window.matchMedia&&window.matchMedia('(pointer: coarse)').matches&&Math.min(Number(screen.width)||window.innerWidth,window.innerWidth)<=900);
    return (mobileUa||ipadOs||compactTouch||(navigator.userAgentData&&navigator.userAgentData.mobile===true))?'mobile-browser':'desktop-browser';
  }
  var browserUiMode = window.BasaltUiMode || fallbackBrowserUiMode();
  var browserMobileMode = browserUiMode === 'mobile-browser';
  document.documentElement.setAttribute('data-bp-ui-mode',browserUiMode);
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
  function installDesktopModalCloseButtons(){
    if(!document.body||!document.body.classList.contains('browser-mode')||document.body.dataset.bpModalCloseObserver)return;
    document.body.dataset.bpModalCloseObserver='1';
    function enhance(overlay){
      if(!overlay||!overlay.classList||!overlay.classList.contains('modal-backdrop'))return;
      if(!isDesktopWideShell())return;
      var modal=overlay.querySelector('.filter-modal,.modal-filter,.boost-modal,.maintenance-modal,.admin-user-modal,.product-detail-modal,.favorites-share-composer,.site-key-activation-modal') || (overlay.querySelector('.modal-content') ? overlay.querySelector('.modal-content').parentElement : null);
      if(!modal)return;
      var contentHost=modal.querySelector('.modal-content');
      if(contentHost){
        contentHost.style.position='relative';
        var scrollViewport=null;
        for(var childIndex=0;childIndex<contentHost.children.length;childIndex++){
          if(contentHost.children[childIndex].classList.contains('modal-scroll-viewport')){scrollViewport=contentHost.children[childIndex];break;}
        }
        if(!scrollViewport){
          scrollViewport=document.createElement('div');
          scrollViewport.className='modal-scroll-viewport';
          Array.prototype.slice.call(contentHost.childNodes).forEach(function(child){
            if(child.nodeType===1&&child.classList&&child.classList.contains('desktop-modal-close'))return;
            scrollViewport.appendChild(child);
          });
          contentHost.appendChild(scrollViewport);
        }
      }
      if(modal.querySelector('.desktop-modal-close'))return;
      var closeHost=contentHost||modal;
      closeHost.style.position='relative';
      var button=document.createElement('button');button.type='button';button.className='desktop-modal-close';
      button.setAttribute('aria-label',localizeUiText('Закрыть','Close','Жабу'));
      button.setAttribute('title',localizeUiText('Закрыть','Close','Жабу'));
      button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      button.addEventListener('click',function(){
        // Reuse the modal's existing backdrop handler so scoped cleanup (Escape listeners, etc.) still runs.
        try{overlay.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));}catch(e){}
        if(overlay.isConnected){overlay.classList.add('closing');window.setTimeout(function(){if(overlay.isConnected)overlay.remove();},240);}
      });
      closeHost.insertBefore(button,closeHost.firstChild);
    }
    Array.prototype.forEach.call(document.querySelectorAll('.modal-backdrop'),enhance);
    window.BasaltRefreshDesktopModals=function(){Array.prototype.forEach.call(document.querySelectorAll('.modal-backdrop'),enhance);};
    var observer=new MutationObserver(function(records){records.forEach(function(record){record.addedNodes.forEach(function(node){if(node.nodeType!==1)return;enhance(node);if(node.querySelectorAll)node.querySelectorAll('.modal-backdrop').forEach(enhance);});});});
    observer.observe(document.body,{childList:true,subtree:true});
    window.addEventListener('resize',function(){if(!isDesktopWideShell())return;document.querySelectorAll('.modal-backdrop').forEach(enhance);},{passive:true});
  }
  function initialScreenFromDocument(){
    var declared=document.body&&document.body.getAttribute('data-initial-screen');
    var query=new URLSearchParams(window.location.search||'');
    if(query.get('mode')==='best')return 'best';
    return declared||'home';
  }
  var activeScreen = initialScreenFromDocument();
  var browserSessionActive = false;
  function applyBodyUiModeClass(){
    if(!document.body)return;
    document.body.classList.toggle('telegram-shell',!!initData);
    document.body.classList.toggle('mobile-browser-shell',!initData&&browserMobileMode);
    document.body.classList.toggle('desktop-shell',!initData&&!browserMobileMode);
  }
  applyBodyUiModeClass();
  var fileRefreshTimer = null;
  var cache = {};
  var settings = {language:'ru',theme:'mono',appearance:'dark',notify_updates:1,notify_processed_files:1,notify_subscription:1,seller_products_public:0,seller_dm_enabled:0};
  function appearanceStorageKey(){var id=initDataUser&&initDataUser.id?String(initDataUser.id):'';return id?'basalt-appearance-v1-'+id:'';}
  try { var savedAppearanceKey=appearanceStorageKey(); if(savedAppearanceKey){var savedAppearance=JSON.parse(localStorage.getItem(savedAppearanceKey)||'null');if(savedAppearance&&typeof savedAppearance==='object'){if(['mono','ocean','forest','rose','amber'].indexOf(savedAppearance.theme)!==-1)settings.theme=savedAppearance.theme;if(['dark','light'].indexOf(savedAppearance.appearance)!==-1)settings.appearance=savedAppearance.appearance;if(['ru','en','kz'].indexOf(savedAppearance.language)!==-1)settings.language=savedAppearance.language;}} } catch (appearanceReadError) {}
  var savedSettings = Object.assign({}, settings);
  var settingsDraftActive = false;
  var expandedNotificationId = null;
  var profile = null;
  var currentUserAvatarCacheUrl = '';
  var currentUserAvatarCacheUserId = '';
  var botUsername = String(window.BASALT_BOT_USERNAME || 'YOUR_BOT_USERNAME');
  var isAdmin = false;
  var currentRole = 'seller';
  var currentPriceMultiplier = 1.0;
  var overview = null;
  var searchTimer = null;
  // Once a screen cannot load, keep every section in the same app-wide failure state.
  var globalLoadFailure = null;
  var bpLastApiRequestAt = 0;
  var bpLastGuardedApiRequestAt = 0;
  var bpModalSessionCheckTimer = null;
  var priceFileStatusSnapshot = Object.create(null);
  var priceFileStatusExpectedIds = Object.create(null);
  var priceFileStatusInitialized = false;
  if (tg) { tg.ready(); tg.expand(); try { tg.setHeaderColor('#0c0c0d'); tg.setBackgroundColor('#0c0c0d'); } catch (e) {} }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function iconSvg(name) { return window.BasaltIcons.svg(name); }
  function excelIconSvg() { return '<svg class="excel-logo" viewBox="0 0 48 48" role="img" aria-label="Microsoft Excel" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M24 5.5h13l6 6V40a3 3 0 0 1-3 3H24"/><path d="M37 5.5v6h6"/><path d="M27 16.5h11M27 23h11M27 29.5h11M27 36h11"/><rect x="2.5" y="12" width="19.5" height="25" rx="3"/><path d="m7.5 19 9 12m0-12-9 12"/></svg>'; }
  function api(action, extra) {
    var writeActions = ['set_price_multiplier','delete_file','save_settings','admin_update_user','admin_extend_user_subscription','admin_delete_user','generate_keys','create_announcement','mark_read','reveal_subscription_key','save_browser_features','session_sync','upload_price_list','stage_price_list','request_upload_scan','finalize_upload_batch','cancel_upload_batch','activate_subscription_key'];
    if (previewModeActive && writeActions.indexOf(String(action)) !== -1) {
      var locked = new Error('preview_readonly'); locked.code = 'preview_readonly'; return Promise.reject(locked);
    }
    bpLastApiRequestAt = Date.now();
    // Periodic status reads are not user activity and must not keep a session alive
    // or trigger maintenance/ban checks on every poll.
    if (['files','upload_review_status'].indexOf(String(action)) === -1) bpLastGuardedApiRequestAt = bpLastApiRequestAt;
    return window.BasaltApi.request(action, extra, initData).then(function(result){
      if(previewModeActive && action==='overview' && result){
        result.role=previewRole;result.is_admin=previewRole==='admin';
        if(result.profile)result.profile.role=previewRole;
      }
      return result;
    }).catch(function(error){
      if(!initData && browserSessionActive && error && (error.code==='browser_session_expired'||error.code==='browser_access_disabled')){
        browserSessionActive=false;startBrowserMode();
      }
      if(error && error.code==='database_timeout' && app){
        globalLoadFailure=error;
        renderGlobalLoadError(error);
      }
      if (error) handleApiGuardError(error);
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
    hideScreenLoading();app.innerHTML = translateHtml(html);
    app.classList.remove('screen-loading');revealUiChrome();
    app.style.minHeight = '';
    var retry = document.getElementById('globalServerRetry');
    if (retry) retry.onclick = function () { window.location.reload(); };
  }
  function toast(text) {
    var el=document.getElementById('toast');
    if(!el)return;
    if(el.parentNode!==document.body)document.body.appendChild(el);
    el.textContent=translateHtml(friendlyError(text));
    el.classList.add('show');
    window.clearTimeout(el._hideTimer);
    el._hideTimer=window.setTimeout(function(){el.classList.remove('show');},3200);
  }


  function normalizedTelegramUserpicUrl(value) {
    try {
      var parsed = new URL(String(value || ''), window.location.href);
      var host = String(parsed.hostname || '').toLowerCase();
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return '';
      var telegramHost = /^(?:t\.me|telegram\.org|[a-z0-9.-]+\.telegram\.org|[a-z0-9.-]+\.cdn-telegram\.org|telesco\.pe|[a-z0-9.-]+\.telesco\.pe)$/i.test(host);
      var avatarPath = /\/userpic\//i.test(parsed.pathname) || (/\.telesco\.pe$/i.test(host) && /\/file\//i.test(parsed.pathname));
      return telegramHost && avatarPath ? parsed.href : '';
    } catch (e) { return ''; }
  }
  function isTelegramUserpicUrl(value) { return !!normalizedTelegramUserpicUrl(value); }
  function removeFailedAvatarImage(image) {
    if (!image || !image.classList || !image.classList.contains('avatar-image')) return;
    if (image.__basaltAvatarTimer) { clearTimeout(image.__basaltAvatarTimer); image.__basaltAvatarTimer = null; }
    var shell = image.closest ? image.closest('.avatar-shell') : image.parentNode;
    if (shell && shell.classList) shell.classList.remove('has-photo', 'is-loaded');
    if (image.parentNode) image.parentNode.removeChild(image);
  }
  function watchTelegramAvatar(image) {
    if (!image || image.nodeType !== 1 || image.tagName !== 'IMG' || !image.classList.contains('avatar-image') || image.__basaltAvatarWatched) return;
    image.__basaltAvatarWatched = true;
    var source = image.getAttribute('src') || image.src || '';
    var isTelegramSource = isTelegramUserpicUrl(source);
    image.addEventListener('error', function () { removeFailedAvatarImage(image); }, {once: true});
    image.addEventListener('load', function () {
      if (image.__basaltAvatarTimer) { clearTimeout(image.__basaltAvatarTimer); image.__basaltAvatarTimer = null; }
    }, {once: true});
    // A slow Telegram CDN must not poison localStorage permanently. On timeout the
    // placeholder is shown, and the next page open is allowed to try the same URL again.
    if (!isTelegramSource) return;
    image.__basaltAvatarTimer = setTimeout(function () {
      if (!image.isConnected) return;
      if (image.complete && image.naturalWidth > 0) return;
      removeFailedAvatarImage(image);
    }, 12000);
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
    if (!image || image.tagName !== 'IMG' || !image.classList) return;
    if (image.classList.contains('avatar-image')) {
      removeFailedAvatarImage(image);
      return;
    }
    if (image.classList.contains('brand-logo') && !image.dataset.bpLogoFallback) {
      image.dataset.bpLogoFallback = '1';
      image.src = '/assets/img/logo.webp?v=1';
    }
  }, true);

  function initials(p) {
    p = p || {};
    var s = ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || String(p.username || p.tg_id || 'U');
    return s.split(/\s+/).slice(0, 2).map(function (x) { return x.charAt(0); }).join('').toUpperCase();
  }
  function avatar_url_is_local_for_client(value) {
    return typeof value === 'string' && /^\/uploads\/avatars\/(?:[a-f0-9]{64}\/)?[a-f0-9]{64}\.(?:jpg|jpeg|png|webp|svg)$/i.test(value);
  }
  function photoUrl(p) {
    p = p || {};
    var currentId = profile && profile.tg_id != null ? profile.tg_id : (initDataUser && initDataUser.id);
    var isCurrentTelegramUser = !!(p.tg_id != null && currentId != null
      && String(p.tg_id) === String(currentId));
    if (isCurrentTelegramUser) {
      var userId = String(currentId);
      if (currentUserAvatarCacheUserId === userId && avatar_url_is_local_for_client(currentUserAvatarCacheUrl)) {
        return currentUserAvatarCacheUrl;
      }
      if (avatar_url_is_local_for_client(p.photo_url)) return String(p.photo_url);
      // WebApp initData and Browser Login OIDC carry Telegram's signed photo URL.
      // Use it as a same-session fallback while the server-side local cache is pending.
      var telegramUser = initDataUser || ((tg && tg.initDataUnsafe && tg.initDataUnsafe.user) || null);
      var sourcePhoto = (p.photo_url && !avatar_url_is_local_for_client(p.photo_url))
        ? p.photo_url
        : (telegramUser && telegramUser.photo_url ? telegramUser.photo_url : '');
      return normalizedTelegramUserpicUrl(sourcePhoto);
    }
    var unsafe = (!initData && tg && tg.initDataUnsafe && tg.initDataUnsafe.user) || null;
    var url = (p.photo_url) || (unsafe && unsafe.photo_url) || '';
    url = String(url || '');
    if (/^https?:\/\//i.test(url)) return url;
    if (/^\/?uploads\/avatars\/(?:[a-f0-9]{64}\/)?[a-f0-9]{64}\.(?:jpg|jpeg|png|webp|svg)$/i.test(url)) return url.charAt(0) === '/' ? url : '/' + url;
    return '';
  }
  function avatarMarkup(person, sizeClass, alt, eager) {
    var url = photoUrl(person);
    // Hide the visual fallback immediately when a real URL exists. It is only revealed
    // again by the image error handler, so CSS ordering/load timing cannot cover Telegram's avatar.
    var letter = '<img class="avatar avatar-placeholder" src="/assets/img/avatar-placeholder.webp?v=8" alt="" aria-hidden="true">';
    var image = url ? '<img class="avatar avatar-image" src="' + esc(url) + '" alt="' + esc(alt || '?') + '" decoding="async" loading="' + (eager ? 'eager' : 'lazy') + '" ' + (eager ? 'fetchpriority="high"' : 'fetchpriority="low"') + ' referrerpolicy="no-referrer">' : '';
    var personId = person && person.tg_id ? ' data-avatar-user-id="' + esc(person.tg_id) + '"' : '';
    return '<span class="avatar-shell ' + esc(sizeClass || '') + (url ? ' has-photo' : ' no-photo') + '"' + personId + '>' + letter + image + '</span>';
  }
  function updateCurrentUserAvatar(photoUrl) {
    if (!profile || !profile.tg_id) return;
    var validUrl = String(photoUrl || '');
    if (!/^\/uploads\/avatars\/(?:[a-f0-9]{64}\/)?[a-f0-9]{64}\.(?:jpg|jpeg|png|webp)$/i.test(validUrl)) return;
    currentUserAvatarCacheUrl = validUrl;
    currentUserAvatarCacheUserId = String(profile.tg_id);
    var selector = '.avatar-shell[data-avatar-user-id="' + String(profile.tg_id).replace(/[^0-9]/g, '') + '"]';
    document.querySelectorAll(selector).forEach(function (shell) {
      shell.querySelectorAll('.avatar-image').forEach(function (oldImage) { oldImage.remove(); });
      var image = document.createElement('img');
      image.className = 'avatar avatar-image';
      image.src = validUrl + (validUrl.indexOf('?') === -1 ? '?v=' : '&v=') + Date.now();
      image.alt = 'Аватар пользователя';
      image.decoding = 'async';
      image.loading = 'eager';
      image.referrerPolicy = 'no-referrer';
      shell.classList.remove('no-photo');
      shell.classList.add('has-photo');
      shell.appendChild(image);
      watchTelegramAvatar(image);
    });
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
      'Быстрый доступ':'Quick access','Прайс-листы':'Price lists','Файлы и обработка':'Files and processing','Поиск товаров':'Product search','Фильтры и сравнение цен':'Filters and price comparison','Уведомления':'Notifications','Обновления и статусы файлов':'Updates and file statuses','Поддержка':'Support','FAQ и обратная связь':'FAQ and feedback',
      'РАБОТА С ДАННЫМИ':'YOUR DATA','Прайс-листы':'Price lists','Сайт принимает Excel и CSV, распознаёт строки и собирает товары в единый каталог.':'The website accepts Excel and CSV files, parses their rows and builds a unified catalogue.',
      'Добавить новый прайс':'Add a price list','Выберите один или несколько Excel/CSV-файлов на этой странице. После обработки данные появятся здесь.':'Select one or more Excel/CSV files on this page. The processed data will appear here.',
      'Открыть чат с ботом ↗':'Open bot chat ↗','Ваши файлы':'Your files','файлов':'files','Каталог пока пуст':'Your catalog is empty','Добавьте первый прайс-лист с помощью формы загрузки на этой странице.':'Upload your first price list using the form on this page.','Перейти к боту':'Open bot',
      'Инструменты каталога':'Catalog tools','Поиск и фильтры':'Search and filters','Бренд, тип, цена и объём':'Brand, type, price and volume','Лучшие цены':'Best prices','Сравнение позиций в прайсах':'Compare items across price lists',
      'ДОСТУП И ТАРИФ':'ACCESS & PLAN','Ваша подписка':'Your subscription','Управляйте сроком доступа и получайте напоминания до окончания подписки.':'Manage access and get reminders before your subscription expires.',
      'Активна':'Active','Не активна':'Inactive','Все функции доступны':'All features are available','Требуется активация':'Activation required','Нет доступа':'No access','Активируйте ключ на сайте, чтобы начать работу.':'Enter an activation key on the website to get started.',
      'Что включено':'What is included','Неограниченный каталог прайс-листов':'Price list catalog','Обработка файлов и единый список товаров':'File processing and unified product list','Поиск и сравнение цен':'Search and price comparison','Фильтры по бренду, типу и объёму':'Filters by brand, type and volume','Уведомления о сроке':'Expiry reminders','За 72 часа, затем каждые 24 часа до окончания':'72 hours before expiry, then every 24 hours','Продлить доступ':'Extend access','Активация на сайте включена администратором. Ключ можно ввести здесь или активировать в Telegram-боте.':'Website activation is enabled by the administrator. Enter a key here or activate it in the Telegram bot.','Активация ключей на сайте выключена. Используйте Telegram-бота для активации и продления подписки.':'Website key activation is disabled. Use the Telegram bot to activate or renew your subscription.','Ввести ключ активации':'Enter activation key','Перейти к активации':'Go to activation','Активируйте ключ на сайте, чтобы открыть каталог и остальные разделы.':'Activate a key on the website or in the Telegram bot to open the catalogue and other sections.','Активация ключа':'Key activation','Введите полный ключ. После проверки срок подписки будет активирован или продлён в соответствии с параметрами ключа.':'Enter the full key. After verification, your subscription will be activated or extended according to the key settings.','Ключ активации':'Activation key','Например, BP-…':'For example, BP-…','Активировать':'Activate','Ключ активации вводится в чате с ботом. Новый ключ активирует или продлевает доступ согласно настройкам подписки.':'Enter an activation key in the bot chat. A new key activates or extends access.','Перейти к активации в Telegram ↗':'Activate in Telegram ↗',
      'ПЕРСОНАЛИЗАЦИЯ':'PERSONALIZATION','Подстройте приложение под себя — от внешнего вида до уведомлений.':'Customize the app appearance and notifications.','Язык интерфейса':'Interface language','Язык':'Language','Выберите язык приложения':'Choose app language','Цветовая тема':'Color theme','Монохромная по умолчанию':'Monochrome by default','Режим отображения':'Appearance','Можно переключить любую тему на светлую или тёмную':'Switch any theme between light and dark','Тёмный':'Dark','Светлый':'Light','Системный':'System','Сохранить настройки':'Save settings',
      'Обновления приложения':'App updates','Новости, новые возможности и изменения':'News, new features and changes','Обработанные файлы':'Processed files','Результат загрузки и ошибки распознавания':'Upload results and parsing errors','Подписка':'Subscription','Напоминания за 72 часа и далее каждые 24 часа':'Reminders 72 hours before expiry and every 24 hours after','Открыть центр уведомлений ↗':'Open notification center ↗',
      'ЦЕНТР СОБЫТИЙ':'NOTIFICATION CENTER','Всё важное о прайс-листах, обновлениях и подписке — в одном списке.':'Important price-list, update and subscription events in one place.','Пока тихо':'All quiet for now','Новые события появятся здесь.':'New events will appear here.','Прочитано':'Read',
      'КАТАЛОГ':'CATALOG','Ищите по названию, бренду или артикулу и сортируйте результаты.':'Search by name, brand or SKU and sort results.','СРАВНЕНИЕ':'PRICE COMPARISON','Сравните найденные позиции по стоимости.':'Compare matching products by price.','Цена ↑':'Price ↑','Цена ↓':'Price ↓','Объём':'Volume','Порядок вывода':'Sort order','Сначала дешевле':'Lowest price first','Сначала дороже':'Highest price first','Сначала старые':'Oldest first','А–Я':'A–Z','Я–А':'Z–A','Интервал цен':'Price range','Клавиатура':'Keyboard','Ползунок':'Slider','Ничего не найдено':'No results found','Попробуйте другое название или загрузите ещё один прайс.':'Try another search or upload another price list.',
      'МЫ НА СВЯЗИ':'WE ARE HERE TO HELP','Поможем разобраться с обработкой прайсов, подпиской и возможностями приложения.':'Help with price-list processing, subscriptions and app features.','Связаться с разработчиком':'Contact developer','Вопросы, идеи и сообщения об ошибках':'Questions, ideas and bug reports','Частые вопросы':'Frequently asked questions',
      'Панель администратора':'Admin panel','Админ-панель':'Admin panel','Состояние сервиса и инструменты управления подписками.':'Service status and subscription management tools.','Тех. работы':'Maintenance','Технические работы':'Maintenance','Доступ для пользователей временно ограничен.':'User access is temporarily restricted.','Пользователи и бот работают в обычном режиме.':'Users and the bot are operating normally.','Изменить':'Edit','Назначить':'Schedule','Завершить':'End','Окончание:':'Ends:','Опубликовано:':'Published:','Публикуем…':'Publishing…','Ключ недоступен для показа':'Key cannot be displayed','Нажмите на глаз, чтобы показать ключ':'Click the eye to reveal the key','Настройки доступа сохранены':'Access settings saved','Заполните заголовок и текст обновления':'Enter an update title and message','Технические работы завершены':'Maintenance completed','Доступ и возможности сайта':'Site access and features','Доступ к сайту':'Site access','Разрешить вход на сайте по Telegram-аккаунту, вне WebApp.':'Allow sign-in to the website with a Telegram account, outside the WebApp.','Сессия браузера хранится в cookie 7 дней.':'The browser session is stored in a cookie for 7 days.','Ключ активации подписки':'Subscription activation key','Продление в очереди':'Renewal queue','В очереди':'Queued','Ожидает':'Pending','Начало:':'Starts:','Прочитать все':'Mark all as read','Все прочитано':'All read','Загрузка прайс-листов и активация ключей на сайте работают независимо от этой настройки.':'Website price-list uploads and key activation work independently of this setting.','Доступ из обычного браузера':'Regular browser access','Разрешить вход на сайте по Telegram-аккаунту, вне WebApp. Сессия браузера хранится в cookie 7 дней.':'Allow sign-in on the website with a Telegram account outside the WebApp. The browser session is stored in a cookie for 7 days.','Загрузка и скачивание прайс-листов на сайте':'Upload and download price lists on the website','Показывать веб-форму загрузки и скачивание файлов. Обработку выполняет общий серверный парсер бота.':'Show the website upload form and file downloads. Files are processed by the bot’s shared server parser.','Активация ключей на сайте':'Website key activation','Разрешить ввод ключа на странице «Подписка» в WebApp и обычном браузере. Если выключено, ключи активируются только через Telegram-бота.':'Allow activation keys to be entered on the Subscription page in the WebApp and regular browser. When disabled, keys can only be activated through the Telegram bot.','Настройки сохраняются в общей базе данных.':'Settings are saved in the shared database.','Выключение активации на сайте не затрагивает активацию ключей через Telegram-бота.':'Disabling website activation does not affect key activation through the Telegram bot.','Создать ключи':'Generate keys','Количество':'Count','Срок, дней':'Duration, days','Сгенерировать ключи':'Generate keys','Ключи активации':'Activation keys','Всего: ':'Total: ','Ведутся':'In progress','Не назначено':'Not scheduled','Приватность продавца':'Seller privacy','Общедоступность товаров':'Public product visibility','Если выключено, товары скрыты от покупателей и обозначаются анонимно.':'When off, your products are hidden from buyers and shown anonymously.','Доступность личных сообщений':'Direct messages','Разрешить покупателям связываться с вами и отправлять списки избранного.':'Allow buyers to contact you and share their favorites.','Пользователи':'Users','Нет доступа':'No access','Панель доступна только администраторам.':'This panel is available to administrators only.',
      'Профиль Telegram':'Telegram profile','Пользователь Telegram':'Telegram user','Без username':'No username','Аватар':'Avatar','Прайс-лист обработан':'Price list processed','Прайс-лист удалён':'Price list deleted','Цена не распознана':'Price not recognized','Обработан':'Processed','Скачать':'Download','Удалить':'Delete','на проверку':'to review','товаров':'products','день':'day','дня':'days','дней':'days','Действует до':'Valid until','Доступ до:':'Access until:','Ключ:':'Key:','не активирован':'not activated','Доступ открыт':'Access enabled','Ожидает активации':'Awaiting activation','Опубликовать обновление':'Publish an update','Сообщение появится в центре уведомлений у пользователей, которые включили уведомления об обновлениях.':'The message will appear in notifications for users who enabled app updates.','Заголовок обновления':'Update title','Текст сообщения':'Message text','Опубликовать':'Publish','Активирован':'Activated','Свободен':'Available','Доступен':'Available','Использован':'Used','Строк на проверку':'Rows needing review','Строк обработано':'Rows processed','Например, Dior Sauvage или 100 ml':'For example, Dior Sauvage or 100 ml','тип не указан':'type not specified','объём не указан':'volume not specified','Наборы':'Sets','Tester':'Tester','Нужна проверка':'Needs review','Укажите BOT_USERNAME в конфигурации сайта и откройте чат с ботом.':'Set BOT_USERNAME in the site config, then open the bot chat.','Укажите DEVELOPER_USERNAME в конфигурации сайта.':'Set DEVELOPER_USERNAME in the site config.','Настройки сохранены':'Settings saved','Прайс-лист удалён':'Price list deleted','Ключи скопированы':'Keys copied','Ключ скопирован':'Key copied','Показать ключ':'Show key','Скрыть ключ':'Hide key','Полный ключ недоступен для старых записей.':'The full key is unavailable for older records.','Полный ключ не сохранялся для старых записей':'Full values were not stored for older keys','Не удалось скопировать ключи. Выделите их и скопируйте вручную.':'Could not copy the keys. Select and copy them manually.','Не удалось скопировать ключ. Попробуйте выделить его вручную.':'Could not copy the key. Select and copy it manually.','Создано ключей: ':'Keys created: ','Как загрузить прайс-лист?':'How do I upload a price list?','Откройте страницу «Прайсы», выберите один или несколько Excel/CSV-файлов и нажмите «Загрузить и обработать». После серверной обработки товары появятся в каталоге.':'Open the “Price lists” page, select one or more Excel/CSV files, and click “Upload and process”. Products will appear in your catalogue after server-side processing.','Откройте страницу «Прайсы», выберите один или несколько Excel/CSV-файлов и нажмите «Загрузить и обработать».':'Open “Price lists”, select one or more Excel/CSV files, and click “Upload and process”.','Почему часть строк требует проверки?':'Why do some rows need review?','Цена или название не распознаны однозначно. Такие значения сохраняются для ручной проверки.':'The price or name could not be identified confidently. These entries are saved for manual review.','Когда придёт напоминание о подписке?':'When will I get a subscription reminder?','Сколько времени обрабатывается один файл?':'How long does one file take to process?','Обычно обработка одного файла занимает примерно 3–5 минут. Время зависит от размера прайс-листа и количества строк.':'Processing one file usually takes about 3–5 minutes. The time depends on the price list size and the number of rows.','Как обрабатываются конфликтные файлы?':'How are conflicting files handled?','При совпадении система предложит выбрать «Отмена» или «Замена». Новая версия заменит старую только после успешной обработки.':'If a new price list conflicts with one already uploaded (for example, it is another version of the same list), the bot will ask you to choose an action for the conflicting files. For the most reliable update in less time, delete the old conflicting price list on the “Price lists” page before uploading the new one.','При включённых уведомлениях: за 72 часа до окончания и далее каждые 24 часа.':'When notifications are enabled: 72 hours before expiry and every 24 hours thereafter.','Товары скрыты':'Products hidden','Товаров: ':'Products: ','Какие форматы поддерживаются?':'Which formats are supported?','Срок вашей подписки истёк. Отправьте /start боту, чтобы активировать новый ключ.':'Your subscription has expired. Send /start to the bot to activate a new key.','До окончания доступа осталось около':'About this much time remains before access expires:','Продлите подписку заранее, чтобы не потерять доступ.':'Renew in advance to keep access.',
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
      'Прайс-листы, поиск выгодных предложений и контроль подписки — в одном месте.':'Прайс-парақтар, тиімді ұсыныстарды іздеу және жазылымды басқару — бір жерде.','Подписка активна':'Жазылым белсенді','Подписка не активна':'Жазылым белсенді емес','Предыдущая активная подписка деактивирована.':'Алдыңғы белсенді жазылым өшірілді.','Доступ до':'Қолжетімділік мерзімі','Моя подписка ↗':'Жазылымым ↗','Все прайсы ↗':'Барлық прайс-парақтар ↗','Прайс-листов':'Прайс-парақтар','Позиций каталога':'Каталогтағы тауарлар','Новых уведомлений':'Жаңа хабарландырулар','Дней осталось':'Қалған күндер','Файлы и обработка':'Файлдар және өңдеу','Фильтры и сравнение цен':'Сүзгілер және бағаларды салыстыру','Обновления и статусы файлов':'Жаңартулар және файл күйлері','FAQ и обратная связь':'FAQ және кері байланыс','РАБОТА С ДАННЫМИ':'ДЕРЕКТЕРМЕН ЖҰМЫС','Сайт принимает Excel и CSV, распознаёт строки и собирает товары в единый каталог.':'Сайт Excel және CSV файлдарын қабылдап, жолдарды өңдейді және тауарларды бірыңғай каталогқа біріктіреді.','Добавить новый прайс':'Жаңа прайс-парақ қосу','Выберите один или несколько Excel/CSV-файлов на этой странице. После обработки данные появятся здесь.':'Осы бетте бір немесе бірнеше Excel/CSV файлын таңдаңыз. Өңделген деректер осында пайда болады.','Открыть чат с ботом ↗':'Ботпен чатты ашу ↗','Ваши файлы':'Файлдарыңыз','файлов':'файл','Каталог пока пуст':'Каталог әзірге бос','Добавьте первый прайс-лист с помощью формы загрузки на этой странице.':'Алғашқы прайс-парақты осы беттегі жүктеу пішіні арқылы қосыңыз.','Перейти к боту':'Ботқа өту','Инструменты каталога':'Каталог құралдары','Поиск и фильтры':'Іздеу және сүзгілер','Бренд, тип, цена и объём':'Бренд, түрі, бағасы және көлемі','Лучшие цены':'Ең тиімді бағалар','Сравнение позиций в прайсах':'Прайс-парақтардағы тауарларды салыстыру','ДОСТУП И ТАРИФ':'ҚОЛЖЕТІМДІЛІК ЖӘНЕ ТАРИФ','Управляйте сроком доступа и получайте напоминания до окончания подписки.':'Қолжетімділік мерзімін басқарып, жазылым аяқталмай тұрып еске салулар алыңыз.','Активна':'Белсенді','Не активна':'Белсенді емес','Все функции доступны':'Барлық функция қолжетімді','Требуется активация':'Белсендіру қажет','Нет доступа':'Қолжетімділік жоқ','Активируйте ключ на сайте, чтобы начать работу.':'Жұмысты бастау үшін сайтта белсендіру кілтін енгізіңіз.','Неограниченный каталог прайс-листов':'Прайс-парақтардың шектеусіз каталогы','Обработка файлов и единый список товаров':'Файлдарды өңдеу және бірыңғай тауарлар тізімі','Поиск и сравнение цен':'Іздеу және бағаларды салыстыру','Фильтры по бренду, типу и объёму':'Бренд, түрі және көлемі бойынша сүзгілер','Уведомления о сроке':'Мерзім туралы хабарландырулар','За 72 часа, затем каждые 24 часа до окончания':'72 сағат бұрын, одан кейін мерзімі біткенше әр 24 сағат сайын','Активация на сайте включена администратором. Ключ можно ввести здесь или активировать в Telegram-боте.':'Сайтта белсендіруді әкімші қосты. Кілтті осында енгізуге немесе Telegram ботында белсендіруге болады.','Активация ключей на сайте выключена. Используйте Telegram-бота для активации и продления подписки.':'Сайтта кілттерді белсендіру өшірулі. Жазылымды белсендіру немесе ұзарту үшін Telegram ботын пайдаланыңыз.','Ввести ключ активации':'Белсендіру кілтін енгізу','Перейти к активации':'Белсендіруге өту','Активируйте ключ на сайте, чтобы открыть каталог и остальные разделы.':'Каталог пен басқа бөлімдерді ашу үшін кілтті сайтта немесе Telegram ботында белсендіріңіз.','Активация ключа':'Кілтті белсендіру','Введите полный ключ. После проверки срок подписки будет активирован или продлён в соответствии с параметрами ключа.':'Толық кілтті енгізіңіз. Тексеруден кейін жазылым кілт параметрлеріне сәйкес белсендіріледі немесе ұзартылады.','Ключ активации':'Белсендіру кілті','Например, BP-…':'Мысалы, BP-…','Активировать':'Белсендіру','Активация на сайте включена администратором. Ключ можно ввести здесь или активировать в Telegram-боте.':'Сайтта белсендіруді әкімші қосты. Кілтті осында енгізуге немесе Telegram ботында белсендіруге болады.','Активация ключей на сайте выключена. Используйте Telegram-бота для активации и продления подписки.':'Сайтта кілттерді белсендіру өшірулі. Жазылымды белсендіру немесе ұзарту үшін Telegram ботын пайдаланыңыз.','Ввести ключ активации':'Белсендіру кілтін енгізу','Перейти к активации':'Белсендіруге өту','Активируйте ключ на сайте, чтобы открыть каталог и остальные разделы.':'Каталог пен басқа бөлімдерді ашу үшін кілтті сайтта немесе Telegram ботында белсендіріңіз.','Активация ключа':'Кілтті белсендіру','Введите полный ключ. После проверки срок подписки будет активирован или продлён в соответствии с параметрами ключа.':'Толық кілтті енгізіңіз. Тексеруден кейін жазылым кілт параметрлеріне сәйкес белсендіріледі немесе ұзартылады.','Ключ активации':'Белсендіру кілті','Например, BP-…':'Мысалы, BP-…','Активировать':'Белсендіру','Ключ активации вводится в чате с ботом. Новый ключ активирует или продлевает доступ согласно настройкам подписки.':'Белсендіру кілтін бот чатында енгізіңіз. Жаңа кілт қолжетімділікті белсендіреді немесе жазылымды ұзартады.','Перейти к активации в Telegram ↗':'Telegram арқылы белсендіру ↗','Подстройте приложение под себя — от внешнего вида до уведомлений.':'Қосымшаның көрінісі мен хабарландыруларын өзіңізге ыңғайлаңыз.','Язык':'Тіл','Выберите язык приложения':'Қосымша тілін таңдаңыз','Монохромная по умолчанию':'Әдепкіде монохром','Можно переключить любую тему на светлую или тёмную':'Кез келген тақырыпты ашық немесе қараңғы режимге ауыстыруға болады','Тёмный':'Қараңғы','Светлый':'Ашық','Системный':'Жүйелік','Обновления приложения':'Қосымша жаңартулары','Новости, новые возможности и изменения':'Жаңалықтар, жаңа мүмкіндіктер және өзгерістер','Обработанные файлы':'Өңделген файлдар','Результат загрузки и ошибки распознавания':'Жүктеу нәтижесі және тану қателері','Напоминания за 72 часа и далее каждые 24 часа':'72 сағат бұрын және одан кейін әр 24 сағат сайын еске салу','Открыть центр уведомлений ↗':'Хабарландырулар орталығын ашу ↗','Всё важное о прайс-листах, обновлениях и подписке — в одном списке.':'Прайс-парақтар, жаңартулар және жазылым туралы маңызды ақпарат бір тізімде.','Пока тихо':'Әзірге хабарландыру жоқ','Новые события появятся здесь.':'Жаңа оқиғалар осында көрсетіледі.','Прочитано':'Оқылды','Ищите по названию, бренду или артикулу и сортируйте результаты.':'Атауы, бренді немесе артикулы бойынша іздеп, нәтижелерді сұрыптаңыз.','Сравните найденные позиции по стоимости.':'Табылған тауарлардың бағаларын салыстырыңыз.','Цена ↑':'Баға ↑','Цена ↓':'Баға ↓','Объём':'Көлем','Порядок вывода':'Сұрыптау реті','Сначала дешевле':'Алдымен арзандары','Сначала дороже':'Алдымен қымбаттары','Сначала старые':'Алдымен ескілері','А–Я':'A–Z','Я–А':'Z–A','Интервал цен':'Баға аралығы','Клавиатура':'Пернетақта','Ползунок':'Сырғытпа','Ничего не найдено':'Ештеңе табылмады','Попробуйте другое название или загрузите ещё один прайс.':'Басқа атауды іздеп көріңіз немесе тағы бір прайс-парақ қосыңыз.','МЫ НА СВЯЗИ':'БАЙЛАНЫСТАМЫЗ','Поможем разобраться с обработкой прайсов, подпиской и возможностями приложения.':'Прайс-парақтарды өңдеу, жазылым және қосымша мүмкіндіктері бойынша көмектесеміз.','Связаться с разработчиком':'Әзірлеушімен байланысу','Вопросы, идеи и сообщения об ошибках':'Сұрақтар, ұсыныстар және қателер туралы хабарламалар','Панель администратора':'Әкімші панелі','Админ-панель':'Әкімші панелі','Состояние сервиса и инструменты управления подписками.':'Қызмет күйі және жазылымдарды басқару құралдары.','Тех. работы':'Техникалық жұмыстар','Технические работы':'Техникалық жұмыстар','Доступ для пользователей временно ограничен.':'Пайдаланушыларға кіру уақытша шектелген.','Пользователи и бот работают в обычном режиме.':'Пайдаланушылар мен бот әдеттегідей жұмыс істеп тұр.','Изменить':'Өзгерту','Назначить':'Жоспарлау','Завершить':'Аяқтау','Окончание:':'Аяқталуы:','Опубликовано:':'Жарияланды:','Публикуем…':'Жариялануда…','Ключ недоступен для показа':'Кілтті көрсету мүмкін емес','Нажмите на глаз, чтобы показать ключ':'Кілтті көрсету үшін көз белгісін басыңыз','Настройки доступа сохранены':'Қолжетімділік баптаулары сақталды','Заполните заголовок и текст обновления':'Жаңарту тақырыбы мен мәтінін толтырыңыз','Технические работы завершены':'Техникалық жұмыстар аяқталды','Доступ и возможности сайта':'Сайтқа кіру және мүмкіндіктер','Доступ к сайту':'Сайтқа кіру','Разрешить вход на сайте по Telegram-аккаунту, вне WebApp.':'WebApp-тан тыс Telegram аккаунты арқылы сайтқа кіруге рұқсат беру.','Сессия браузера хранится в cookie 7 дней.':'Браузер сеансы cookie файлында 7 күн сақталады.','Ключ активации подписки':'Жазылымды белсендіру кілті','Прочитать все':'Барлығын оқу','Все прочитано':'Бәрі оқылды','Загрузка прайс-листов и активация ключей на сайте работают независимо от этой настройки.':'Сайтта прайс-парақтарды жүктеу және кілттерді белсендіру осы параметрге тәуелді емес.','Доступ из обычного браузера':'Кәдімгі браузерден кіру','Разрешить вход на сайте по Telegram-аккаунту, вне WebApp. Сессия браузера хранится в cookie 7 дней.':'WebApp-тан тыс сайтқа Telegram аккаунты арқылы кіруге рұқсат беру. Браузер сеансы cookie ішінде 7 күн сақталады.','Загрузка и скачивание прайс-листов на сайте':'Сайтта прайс-парақтарды жүктеу және жүктеп алу','Показывать веб-форму загрузки и скачивание файлов. Обработку выполняет общий серверный парсер бота.':'Сайтта файл жүктеу пішінін және файлдарды жүктеп алуды көрсету. Өңдеуді боттың ортақ серверлік талдағышы орындайды.','Активация ключей на сайте':'Сайтта кілттерді белсендіру','Разрешить ввод ключа на странице «Подписка» в WebApp и обычном браузере. Если выключено, ключи активируются только через Telegram-бота.':'WebApp және кәдімгі браузердегі «Жазылым» бетінде кілт енгізуге рұқсат беру. Өшірулі болса, кілттер тек Telegram боты арқылы белсендіріледі.','Настройки сохраняются в общей базе данных.':'Баптаулар ортақ дерекқорда сақталады.','Выключение активации на сайте не затрагивает активацию ключей через Telegram-бота.':'Сайтта белсендіруді өшіру Telegram боты арқылы кілт белсендіруге әсер етпейді.','Количество':'Саны','Срок, дней':'Мерзімі, күн','Ключи активации':'Белсендіру кілттері','Всего: ':'Барлығы: ','Ведутся':'Жүріп жатыр','Не назначено':'Тағайындалмаған','Приватность продавца':'Сатушы құпиялығы','Общедоступность товаров':'Тауарлардың жалпыға қолжетімділігі','Если выключено, товары скрыты от покупателей и обозначаются анонимно.':'Өшірулі болса, тауарлар сатып алушылардан жасырылады және анонимді көрсетіледі.','Доступность личных сообщений':'Жеке хабарламаларға рұқсат','Разрешить покупателям связываться с вами и отправлять списки избранного.':'Сатып алушыларға сізбен байланысуға және таңдаулылар тізімін жіберуге рұқсат беру.','Сгенерировать ключи':'Кілттер жасау','Панель доступна только администраторам.':'Бұл панель тек әкімшілерге қолжетімді.','Профиль Telegram':'Telegram профилі','Пользователь Telegram':'Telegram пайдаланушысы','Без username':'Username жоқ','Прайс-лист обработан':'Прайс-парақ өңделді','Прайс-лист удалён':'Прайс-парақ жойылды','Цена не распознана':'Баға танылмады','Обработан':'Өңделді','Скачать':'Жүктеу','Удалить':'Жою','на проверку':'тексеруге','товаров':'тауар','день':'күн','дня':'күн','дней':'күн','Действует до':'Мерзімі аяқталады','Ключ:':'Кілт:','не активирован':'белсендірілмеген','Доступ открыт':'Қолжетімділік ашық','Ожидает активации':'Белсендіруді күтуде','Опубликовать обновление':'Жаңартуды жариялау','Заголовок обновления':'Жаңарту тақырыбы','Текст сообщения':'Хабарлама мәтіні','Опубликовать':'Жариялау','Активирован':'Белсендірілді','Свободен':'Бос','Доступен':'Қолжетімді','Использован':'Пайдаланылды','Строк на проверку':'Тексеруді қажет ететін жолдар','Например, Dior Sauvage или 100 ml':'Мысалы, Dior Sauvage немесе 100 ml','тип не указан':'түрі көрсетілмеген','объём не указан':'көлемі көрсетілмеген','Наборы':'Жиынтықтар','Нужна проверка':'Тексеру қажет','Настройки сохранены':'Баптаулар сақталды','Ключи скопированы':'Кілттер көшірілді','Ключ скопирован':'Кілт көшірілді','Показать ключ':'Кілтті көрсету','Скрыть ключ':'Кілтті жасыру','Полный ключ недоступен для старых записей.':'Ескі жазбалардың толық кілті қолжетімсіз.','Полный ключ не сохранялся для старых записей':'Ескі кілттердің толық мәні сақталмаған','Не удалось скопировать ключи. Выделите их и скопируйте вручную.':'Кілттерді көшіру мүмкін болмады. Оларды белгілеп, қолмен көшіріңіз.','Не удалось скопировать ключ. Попробуйте выделить его вручную.':'Кілтті көшіру мүмкін болмады. Оны белгілеп, қолмен көшіріңіз.','Как загрузить прайс-лист?':'Прайс-парақты қалай жүктеуге болады?','Откройте страницу «Прайсы», выберите один или несколько Excel/CSV-файлов и нажмите «Загрузить и обработать». После серверной обработки товары появятся в каталоге.':'«Прайс-парақтар» бетін ашып, бір немесе бірнеше Excel/CSV файлын таңдап, «Жүктеу және өңдеу» түймесін басыңыз. Сервер өңдегеннен кейін тауарлар каталогта пайда болады.','Откройте страницу «Прайсы», выберите один или несколько Excel/CSV-файлов и нажмите «Загрузить и обработать». После серверной обработки товары появятся в каталоге.':'«Прайс-парақтар» бетін ашып, бір немесе бірнеше Excel/CSV файлын таңдаңыз да, «Жүктеу және өңдеу» түймесін басыңыз. Сервер өңдегеннен кейін тауарлар каталогта пайда болады.','Откройте страницу «Прайсы», выберите один или несколько Excel/CSV-файлов и нажмите «Загрузить и обработать». После серверной обработки товары появятся в каталоге.':'«Прайс-парақтар» бетін ашып, бір немесе бірнеше Excel/CSV файлын таңдаңыз да, «Жүктеу және өңдеу» түймесін басыңыз. Сервер өңдегеннен кейін тауарлар каталогта пайда болады.','Откройте страницу «Прайсы», выберите один или несколько Excel/CSV-файлов и нажмите «Загрузить и обработать».':'«Прайс-парақтар» бетін ашып, бір немесе бірнеше Excel/CSV файлын таңдап, «Жүктеу және өңдеу» түймесін басыңыз.','Почему часть строк требует проверки?':'Неліктен кейбір жолдарды тексеру керек?','Цена или название не распознаны однозначно. Такие значения сохраняются для ручной проверки.':'Баға немесе атау нақты танылмады. Мұндай жазбалар қолмен тексеру үшін сақталады.','Когда придёт напоминание о подписке?':'Жазылым туралы еске салу қашан келеді?','Сколько времени обрабатывается один файл?':'Бір файлды өңдеу қанша уақыт алады?','Обычно обработка одного файла занимает примерно 3–5 минут. Время зависит от размера прайс-листа и количества строк.':'Әдетте бір файлды өңдеу шамамен 3–5 минут алады. Уақыт прайс-парақтың көлеміне және жолдар санына байланысты.','Как обрабатываются конфликтные файлы?':'Қайшылықты файлдар қалай өңделеді?','При совпадении система предложит выбрать «Отмена» или «Замена». Новая версия заменит старую только после успешной обработки.':'Жаңа прайс-парақ бұрын жүктелген файлмен қайшы келсе (мысалы, сол прайс-парақтың басқа нұсқасы болса), бот қайшылықты файлдар үшін әрекетті таңдауды ұсынады. Жаңартуды сенімдірек орындап, уақытты үнемдеу үшін жаңасын жүктемес бұрын «Прайс-парақтар» бетінен ескі қайшылықты файлды жойыңыз.','При включённых уведомлениях: за 72 часа до окончания и далее каждые 24 часа.':'Хабарландырулар қосулы болса: аяқталуына 72 сағат қалғанда және одан кейін әр 24 сағат сайын.','Товары скрыты':'Тауарлар жасырылған','Товаров: ':'Тауар саны: ','Какие форматы поддерживаются?':'Қандай пішімдерге қолдау көрсетіледі?','Срок вашей подписки истёк. Отправьте /start боту, чтобы активировать новый ключ.':'Жазылым мерзімі аяқталды. Жаңа кілтті белсендіру үшін ботқа /start жіберіңіз.','Tester':'Tester','Аватар':'Аватар','До окончания доступа осталось около':'Қолжетімділік аяқталуына шамамен','Продлите подписку заранее, чтобы не потерять доступ.':'Қолжетімділікті жоғалтпау үшін жазылымды алдын ала ұзартыңыз.','КАТАЛОГ':'КАТАЛОГ','СРАВНЕНИЕ':'САЛЫСТЫРУ','Создано ключей: ':'Жасалған кілттер: ','Продление в очереди':'Ұзарту кезегі','В очереди':'Кезекте','Начало:':'Басталуы:','Ожидает':'Күтуде','Ключ добавлен в очередь продления':'Кілт жазылымды ұзарту кезегіне қосылды','Сообщение появится в центре уведомлений у пользователей, которые включили уведомления об обновлениях.':'Хабарлама жаңартулар туралы хабарландыруды қосқан пайдаланушылардың хабарландыру орталығында көрсетіледі.','Строк обработано':'Өңделген жолдар','Укажите BOT_USERNAME в конфигурации сайта и откройте чат с ботом.':'Сайт конфигурациясында BOT_USERNAME мәнін көрсетіп, ботпен чатты ашыңыз.','Укажите DEVELOPER_USERNAME в конфигурации сайта.':'Сайт конфигурациясында DEVELOPER_USERNAME мәнін көрсетіңіз.',
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
    Object.assign(en, {
      'Загрузить прайс-лист':'Upload a price list','Выберите файл или перетащите сюда':'Choose a file or drag it here','Файл пока не выбран':'No file selected yet','После загрузки сервер проверит совпадения с уже сохранёнными прайс-листами.':'After upload, the server checks for conflicts with existing price lists.','После загрузки серверный обработчик добавит результаты в ваш каталог.':'After upload, the server processor will add the results to your catalogue.','Загрузить и обработать':'Upload and process','Excel (.xls, .xlsx) или CSV · до 20 МБ на файл':'Excel (.xls, .xlsx) or CSV · up to 20 MB per file','Активируйте ключ на сайте, чтобы открыть каталог и остальные разделы.':'Enter an activation key on the website to open the catalogue and other sections.','Доступ к сайту':'Site access','Загрузка прайс-листов и активация ключей на сайте работают независимо от этой настройки.':'Website price-list uploads and key activation work independently of this setting.',
      'Файлы сохраняются в приватном каталоге и обрабатываются серверной очередью Basalt Perfume.':'Files are stored in a private directory and processed by the Basalt Perfume server queue.',
      'Обнаружены похожие файлы':'Similar files found','Перетащите каждый файл в нужную колонку. По умолчанию выбран вариант «Отмена».':'Drag each file into the required column. “Cancel” is selected by default.','Отмена':'Cancel','Замена':'Replace','Файл не будет обработан и будет удалён из временной загрузки':'This file will not be processed and will be removed from temporary storage','Старая версия будет заменена после успешной обработки новой':'The old version will be replaced only after the new file is processed successfully','Применить решения':'Apply choices','Отменить загрузку':'Cancel upload',
      'Файлы этого пользователя появятся здесь после загрузки через сайт.':'This user’s files will appear here after uploading through the website.',
      'При совпадении система предложит выбрать «Отмена» или «Замена». Новая версия заменит старую только после успешной обработки.':'If a conflict is found, choose “Cancel” or “Replace”. The old version is replaced only after the new file is processed successfully.',
      'Аватар пользователя':'User avatar','БЕЗ РОЛИ':'NO ROLE','ЦЕНЫ ПРОДАВЦА':'SELLER PRICING','Множитель цены':'Price multiplier','Базовая цена умножается на выбранное значение в каталоге.':'The base price is multiplied by this value in the catalogue.','Текущий множитель':'Current multiplier','Например, 10 USD → ':'For example, 10 USD → ','Сохранить буст':'Save price boost','Загружаем товар…':'Loading product…','КАТАЛОГ BASALT':'BASALT CATALOG','Не удалось загрузить товар':'Could not load product','Связаться с продавцом':'Contact seller','Скачать прайс-лист':'Download price list','Убрать из избранного':'Remove from favourites','Добавить в избранное':'Add to favourites','Продавец отключил личные сообщения':'The seller disabled direct messages','Закрыть':'Close','Выйти из аккаунта':'Sign out','Выходим…':'Signing out…','ПОКУПАТЕЛЬ':'BUYER','ПРОДАВЕЦ':'SELLER',
      'УПРАВЛЕНИЕ ДОСТУПОМ':'ACCESS MANAGEMENT','Пока режим активен, обычные пользователи не смогут работать в WebApp и боте. Администраторам доступ останется.':'While maintenance mode is active, regular users cannot use the WebApp or bot. Administrators will retain access.',
      'Заголовок':'Title','Например, обновление каталога':'For example, catalogue update','Подробное описание':'Detailed description','Что обновляется и почему сервис временно недоступен':'What is being updated and why the service is temporarily unavailable','Длительность':'Duration','Аналог':'Calendar','Минуты':'Minutes','Часы':'Hours','Дни':'Days','Выбор времени окончания':'Select end time','Выберите время в будущем':'Choose a time in the future',
      'Укажите срок окончания технических работ.':'Set the maintenance end time.','Время окончания должно быть в будущем.':'The end time must be in the future.','Технические работы завершатся ':'Maintenance will end ',
      'Заполните заголовок и подробное описание':'Enter a title and detailed description','Выберите длительность и время окончания в будущем':'Choose a duration and a future end time','Технические работы назначены':'Maintenance scheduled',
      'Бессрочно — дата автоматической разблокировки не назначается.':'Permanent — no automatic unblocking date is set.','Выберите дату в календаре и время разблокировки.':'Choose a date in the calendar and an unblocking time.','Блокировка на ':'Blocked for ','Разблокировка: ':'Unblocks: ','Выбранное время уже прошло — задайте будущее время.':'The selected time has passed — choose a future time.','Укажите длительность не менее одной минуты.':'Enter a duration of at least one minute.',
      'Профиль пользователя':'User profile','Открыть пользователя в Telegram':'Open user in Telegram','Открыть в Telegram':'Open in Telegram','Роль пользователя':'User role','Сохранить роль':'Save role','Роль администратора нельзя менять.':'The administrator role cannot be changed.','Пользователь заблокирован':'User is blocked','Пользователь не заблокирован':'User is not blocked','Блокировка пользователя':'Block user','Причина блокировки':'Reason for block','Например, нарушение правил':'For example, rule violation','Подробности и дополнительная информация':'Details and additional information','Внутренние заметки, обстоятельства, уточнения':'Internal notes, circumstances and clarifications','Бессрочная блокировка':'Permanent block','Снять блокировку':'Lift block','Сохранить и заблокировать':'Save and block','Будет рассчитано после выбора срока.':'Will be calculated after selecting a duration.','Удалить пользователя':'Delete user','Удалить (5)':'Delete (5)','Удаление необратимо: будут удалены профиль, товары, прайс-листы, ключи и сохранённые данные пользователя.':'This cannot be undone: the profile, products, price lists, keys and saved user data will be deleted.','Удаление…':'Deleting…','Пользователь удалён':'User deleted','Изменения пользователя сохранены':'User changes saved','Укажите причину блокировки':'Enter a reason for the block','Укажите срок блокировки':'Enter a block duration','Подписка активирована':'Subscription activated','Подписка не активирована':'Subscription not activated','Выберите свободный ключ':'Choose an available key','Нет свободных ключей':'No available keys','Ключ подписки':'Subscription key','Текущий ключ: ':'Current key: ','не назначен':'not assigned','Прайс-листы пользователя':'User price lists','Всего: ':'Total: ','Параметры не указаны':'No details provided','Избранное пользователя':'User favourites','Избранное пока пусто':'No favourites yet','Добавленные пользователем товары появятся здесь.':'Products added by the user will appear here.','Сохранить роль':'Save role','Продлить срок подписки':'Extend subscription','Добавить':'Add','Дни':'Days','Месяцы':'Months','Продлить подписку':'Extend subscription','Новый срок: ':'New expiry: ','Будет добавлено: ':'Will be added: ','Роль сохранена':'Role saved','Срок подписки продлён':'Subscription extended','Подписка активирована':'Subscription activated','Подписка не активирована':'Subscription not activated','Администратор':'Administrator','Без роли':'No role','Покупатель':'Buyer','Продавец':'Seller','Ключ #':'Key #','Нет активного срока':'No active period','Прайс-лист #':'Price list #','Продавец: ':'Seller: ','Продавец: ID ':'Seller ID: ','Пользователь заблокирован':'User is blocked','Пользователь не заблокирован':'User is not blocked','Бессрочно':'Permanently','без подписки':'without a subscription','не назначен':'not assigned','мес.':'mo.','менее минуты':'less than a minute','Блокировка на ':'Blocked for ','Доступ до ':'Access until ','Будет добавлено: ':'Will be added: ','дн.':'d.','мин.':'min.','Подписка заморожена':'Subscription frozen','Загружаем пользователя…':'Loading user…','Блокировка снята':'Block lifted','Не удалось открыть профиль в Telegram.':'Could not open the Telegram profile.','У пользователя нет публичного username. Открытие по ID зависит от поддержки Telegram на устройстве.':'The user has no public username. Opening by ID depends on Telegram support on this device.','Укажите срок продления больше нуля':'Enter an extension period greater than zero','Укажите длительность не менее одной минуты.':'Enter a duration of at least one minute.','Выберите время в будущем':'Choose a future time','Доступ до ':'Access until ','без подписки':'without a subscription','не назначен':'not assigned','Покупатель':'Buyer','Продавец':'Seller','Прайс-лист #':'Price list #','Подписка заморожена':'Subscription frozen'
    });
    Object.assign(kz, {
      'Загрузить прайс-лист':'Прайс-парақты жүктеу','Выберите файл или перетащите сюда':'Файлды таңдаңыз немесе осында сүйреңіз','Файл пока не выбран':'Файл әлі таңдалмады','После загрузки сервер проверит совпадения с уже сохранёнными прайс-листами.':'Жүктегеннен кейін сервер сақталған прайс-парақтармен сәйкестікті тексереді.','После загрузки серверный обработчик добавит результаты в ваш каталог.':'Жүктегеннен кейін сервер өңдегіші нәтижелерді каталогқа қосады.','Загрузить и обработать':'Жүктеу және өңдеу','Excel (.xls, .xlsx) или CSV · до 20 МБ на файл':'Excel (.xls, .xlsx) немесе CSV · әр файл 20 МБ дейін','Активируйте ключ на сайте, чтобы открыть каталог и остальные разделы.':'Каталог пен басқа бөлімдерді ашу үшін сайтта белсендіру кілтін енгізіңіз.','Доступ к сайту':'Сайтқа кіру','Загрузка прайс-листов и активация ключей на сайте работают независимо от этой настройки.':'Сайтта прайс-парақтарды жүктеу және кілттерді белсендіру осы параметрге тәуелді емес.',
      'Файлы сохраняются в приватном каталоге и обрабатываются серверной очередью Basalt Perfume.':'Файлдар жеке каталогта сақталып, Basalt Perfume сервер кезегі арқылы өңделеді.',
      'Обнаружены похожие файлы':'Ұқсас файлдар табылды','Перетащите каждый файл в нужную колонку. По умолчанию выбран вариант «Отмена».':'Әр файлды қажетті бағанға сүйреңіз. Әдепкіде «Бас тарту» таңдалған.','Отмена':'Бас тарту','Замена':'Ауыстыру','Файл не будет обработан и будет удалён из временной загрузки':'Бұл файл өңделмейді және уақытша жүктеуден жойылады','Старая версия будет заменена после успешной обработки новой':'Жаңа файл сәтті өңделгеннен кейін ескі нұсқа ауыстырылады','Применить решения':'Шешімдерді қолдану','Отменить загрузку':'Жүктеуден бас тарту',
      'Файлы этого пользователя появятся здесь после загрузки через сайт.':'Бұл пайдаланушының файлдары сайт арқылы жүктелгеннен кейін осында көрсетіледі.',
      'При совпадении система предложит выбрать «Отмена» или «Замена». Новая версия заменит старую только после успешной обработки.':'Сәйкестік табылса, «Бас тарту» немесе «Ауыстыру» әрекетін таңдаңыз. Ескі нұсқа жаңа файл сәтті өңделгеннен кейін ғана ауыстырылады.',
      'Аватар пользователя':'Пайдаланушы аватары','БЕЗ РОЛИ':'РӨЛСІЗ','ЦЕНЫ ПРОДАВЦА':'САТУШЫ БАҒАЛАРЫ','Множитель цены':'Баға көбейткіші','Базовая цена умножается на выбранное значение в каталоге.':'Каталогта негізгі баға таңдалған мәнге көбейтіледі.','Текущий множитель':'Ағымдағы көбейткіш','Например, 10 USD → ':'Мысалы, 10 USD → ','Сохранить буст':'Көбейткішті сақтау','Загружаем товар…':'Тауар жүктелуде…','КАТАЛОГ BASALT':'BASALT КАТАЛОГЫ','Не удалось загрузить товар':'Тауарды жүктеу мүмкін болмады','Связаться с продавцом':'Сатушымен байланысу','Скачать прайс-лист':'Прайс-парақты жүктеу','Убрать из избранного':'Таңдаулылардан алып тастау','Добавить в избранное':'Таңдаулыларға қосу','Продавец отключил личные сообщения':'Сатушы жеке хабарламаларды өшірді','Закрыть':'Жабу','Выйти из аккаунта':'Аккаунттан шығу','Выходим…':'Шығуда…','ПОКУПАТЕЛЬ':'САТЫП АЛУШЫ','ПРОДАВЕЦ':'САТУШЫ',
      'УПРАВЛЕНИЕ ДОСТУПОМ':'ҚОЛЖЕТІМДІЛІКТІ БАСҚАРУ','Пока режим активен, обычные пользователи не смогут работать в WebApp и боте. Администраторам доступ останется.':'Техникалық жұмыс режимі кезінде қарапайым пайдаланушылар WebApp пен ботты пайдалана алмайды. Әкімшілерге қолжетімділік сақталады.',
      'Заголовок':'Тақырып','Например, обновление каталога':'Мысалы, каталогты жаңарту','Подробное описание':'Толық сипаттама','Что обновляется и почему сервис временно недоступен':'Не жаңартылып жатыр және қызмет неге уақытша қолжетімсіз','Длительность':'Ұзақтығы','Аналог':'Күнтізбе','Минуты':'Минут','Часы':'Сағат','Дни':'Күн','Выбор времени окончания':'Аяқталу уақытын таңдау','Выберите время в будущем':'Болашақ уақытты таңдаңыз',
      'Укажите срок окончания технических работ.':'Техникалық жұмыстардың аяқталу уақытын көрсетіңіз.','Время окончания должно быть в будущем.':'Аяқталу уақыты болашақта болуы керек.','Технические работы завершатся ':'Техникалық жұмыстар аяқталады: ',
      'Заполните заголовок и подробное описание':'Тақырып пен толық сипаттаманы толтырыңыз','Выберите длительность и время окончания в будущем':'Ұзақтықты және болашақ аяқталу уақытын таңдаңыз','Технические работы назначены':'Техникалық жұмыстар жоспарланды',
      'Бессрочно — дата автоматической разблокировки не назначается.':'Мерзімсіз — автоматты бұғаттан шығару күні белгіленбейді.','Выберите дату в календаре и время разблокировки.':'Күнтізбеден күн мен бұғаттан шығару уақытын таңдаңыз.','Блокировка на ':'Бұғаттау мерзімі: ','Разблокировка: ':'Бұғаттан шығару: ','Выбранное время уже прошло — задайте будущее время.':'Таңдалған уақыт өтіп кетті — болашақ уақытты таңдаңыз.','Укажите длительность не менее одной минуты.':'Кемінде бір минуттық ұзақтықты көрсетіңіз.',
      'Профиль пользователя':'Пайдаланушы профилі','Открыть пользователя в Telegram':'Пайдаланушыны Telegram-да ашу','Открыть в Telegram':'Telegram-да ашу','Роль пользователя':'Пайдаланушы рөлі','Сохранить роль':'Рөлді сақтау','Роль администратора нельзя менять.':'Әкімші рөлін өзгертуге болмайды.','Пользователь заблокирован':'Пайдаланушы бұғатталған','Пользователь не заблокирован':'Пайдаланушы бұғатталмаған','Блокировка пользователя':'Пайдаланушыны бұғаттау','Причина блокировки':'Бұғаттау себебі','Например, нарушение правил':'Мысалы, ережені бұзу','Подробности и дополнительная информация':'Толық мәлімет және қосымша ақпарат','Внутренние заметки, обстоятельства, уточнения':'Ішкі жазбалар, жағдайлар және түсіндірмелер','Бессрочная блокировка':'Мерзімсіз бұғаттау','Снять блокировку':'Бұғаттауды алып тастау','Сохранить и заблокировать':'Сақтау және бұғаттау','Будет рассчитано после выбора срока.':'Мерзім таңдалғаннан кейін есептеледі.','Удалить пользователя':'Пайдаланушыны жою','Удалить (5)':'Жою (5)','Удаление необратимо: будут удалены профиль, товары, прайс-листы, ключи и сохранённые данные пользователя.':'Бұл әрекетті қайтару мүмкін емес: профиль, тауарлар, прайс-парақтар, кілттер және пайдаланушының сақталған деректері жойылады.','Удаление…':'Жойылуда…','Пользователь удалён':'Пайдаланушы жойылды','Изменения пользователя сохранены':'Пайдаланушы өзгерістері сақталды','Укажите причину блокировки':'Бұғаттау себебін көрсетіңіз','Укажите срок блокировки':'Бұғаттау мерзімін көрсетіңіз','Подписка активирована':'Жазылым белсендірілді','Подписка не активирована':'Жазылым белсендірілмеді','Выберите свободный ключ':'Бос кілтті таңдаңыз','Нет свободных ключей':'Бос кілттер жоқ','Ключ подписки':'Жазылым кілті','Текущий ключ: ':'Ағымдағы кілт: ','не назначен':'тағайындалмаған','Прайс-листы пользователя':'Пайдаланушының прайс-парақтары','Всего: ':'Барлығы: ','Параметры не указаны':'Мәліметтер көрсетілмеген','Избранное пользователя':'Пайдаланушы таңдаулылары','Избранное пока пусто':'Таңдаулылар әзірге бос','Добавленные пользователем товары появятся здесь.':'Пайдаланушы қосқан тауарлар осында көрсетіледі.','Продлить срок подписки':'Жазылым мерзімін ұзарту','Добавить':'Қосу','Месяцы':'Ай','Продлить подписку':'Жазылымды ұзарту','Новый срок: ':'Жаңа мерзім: ','Будет добавлено: ':'Қосылатын мерзім: ','Роль сохранена':'Рөл сақталды','Срок подписки продлён':'Жазылым мерзімі ұзартылды','Администратор':'Әкімші','Без роли':'Рөл жоқ','Покупатель':'Сатып алушы','Продавец':'Сатушы','Ключ #':'Кілт #','Нет активного срока':'Белсенді мерзім жоқ','Прайс-лист #':'Прайс-парақ #','Продавец: ':'Сатушы: ','Продавец: ID ':'Сатушы ID: ','Бессрочно':'Мерзімсіз','без подписки':'жазылымсыз','не назначен':'тағайындалмаған','мес.':'ай','менее минуты':'бір минуттан аз','Доступ до ':'Қолжетімділік мерзімі: ','дн.':'күн','мин.':'мин.','Подписка заморожена':'Жазылым тоқтатылған','Загружаем пользователя…':'Пайдаланушы жүктелуде…','Блокировка снята':'Бұғаттау алынды','Не удалось открыть профиль в Telegram.':'Telegram профилін ашу мүмкін болмады.','У пользователя нет публичного username. Открытие по ID зависит от поддержки Telegram на устройстве.':'Пайдаланушыда ашық username жоқ. ID арқылы ашу құрылғыдағы Telegram қолдауына байланысты.','Укажите срок продления больше нуля':'Ұзарту мерзімі нөлден үлкен болуы керек','Выберите время в будущем':'Болашақ уақытты таңдаңыз','без подписки':'жазылымсыз','не назначен':'тағайындалмаған','Покупатель':'Сатып алушы','Продавец':'Сатушы','Прайс-лист #':'Прайс-парақ #'
    });
    var map = lang === 'kz' ? kz : en;
    Object.keys(map).sort(function(a,b){return b.length-a.length;}).forEach(function(key){html=html.split(key).join(map[key]);});
    return html.split('__BP_FIXED_RUSSIAN__').join('Русский');
  }
  function localizeUiText(ru,en,kz){return settings.language==='en'?en:(settings.language==='kz'?kz:ru);}
  function isDesktopWideShell(){return !!(document.body&&document.body.classList.contains('desktop-shell')&&document.body.classList.contains('browser-mode')&&window.matchMedia&&window.matchMedia('(min-width:900px)').matches);}
  function updateLocalizedDocumentTitle(screen){
    var titles={
      ru:{home:'Главная',prices:'Прайс-листы',search:'Поиск товаров',best:'Лучшие цены',subscription:'Подписка',settings:'Настройки',notifications:'Уведомления',admin:'Панель администратора',support:'Поддержка'},
      en:{home:'Home',prices:'Price lists',search:'Product search',best:'Best prices',subscription:'Subscription',settings:'Settings',notifications:'Notifications',admin:'Admin panel',support:'Support'},
      kz:{home:'Басты бет',prices:'Прайс-парақтар',search:'Тауарларды іздеу',best:'Үздік бағалар',subscription:'Жазылым',settings:'Баптаулар',notifications:'Хабарландырулар',admin:'Әкімші панелі',support:'Қолдау'}
    };
    var lang=['ru','en','kz'].indexOf(String(settings.language||''))!==-1?settings.language:'ru';
    var label=(titles[lang]&&titles[lang][screen||activeScreen])||titles[lang].home;
    document.title='Basalt Perfume | '+label;
    document.documentElement.lang=lang;
  }
  function syncMarkAllReadButtonPlacement(){
    var button=document.getElementById('markAllReadButton');if(!button)return;
    var desktopWide=isDesktopWideShell();
    if(desktopWide&&activeScreen==='notifications'){
      var toolbar=document.getElementById('notificationsContentToolbar');
      if(toolbar&&button.parentNode!==toolbar)toolbar.appendChild(button);
      return;
    }
    if(desktopWide){
      var meta=document.querySelector('.desktop-page-meta-actions');
      if(meta&&button.parentNode!==meta)meta.insertBefore(button,meta.firstChild);
      return;
    }
    var topbar=document.querySelector('.topbar');
    var bell=topbar&&topbar.querySelector('#notificationsButton');
    if(topbar&&bell&&(button.parentNode!==topbar||button.nextElementSibling!==bell))topbar.insertBefore(button,bell);
  }
  function syncTelegramBackButton(screen){
    if(!initData||!tg||!tg.BackButton)return;
    try{
      if(!window.__bpTelegramBackButtonBound){
        tg.BackButton.onClick(function(){if(activeScreen!=='home')nav('home');});
        window.__bpTelegramBackButtonBound=true;
      }
      if(screen==='home')tg.BackButton.hide();else tg.BackButton.show();
    }catch(error){}
  }
  function localizedItemCount(value){var n=Math.max(0,Number(value)||0);if(settings.language==='en')return n+' '+(n===1?'item':'items');if(settings.language==='kz')return n+' тауар';var mod10=n%10,mod100=n%100;return n+' '+(mod10===1&&mod100!==11?'товар':(mod10>=2&&mod10<=4&&!(mod100>=12&&mod100<=14)?'товара':'товаров'));}
  function localizedFavoritesCount(filtered,total){var f=Math.max(0,Number(filtered)||0),t=Math.max(0,Number(total)||0);return settings.language==='en'?f+' of '+t+' items':(settings.language==='kz'?f+' / '+t+' тауар':f+' из '+t+' товаров');}
  function configureRoleNavigation() {
    var navEl=document.getElementById('bottomNav'); if(!navEl) return;
    var priceButton=navEl.querySelector('[data-nav-primary]');
    if(priceButton){var targetNavScreen=currentRole==='buyer'?'search':'prices';if(priceButton.getAttribute('data-screen')!==targetNavScreen)priceButton.setAttribute('data-screen',targetNavScreen);var sm=priceButton.querySelector('small');var targetNavLabel=currentRole==='buyer'?(settings.language==='en'?'Search':(settings.language==='kz'?'Іздеу':'Поиск')):(settings.language==='en'?'Price lists':(settings.language==='kz'?'Прайс-парақтар':'Прайсы'));if(sm&&sm.textContent!==targetNavLabel)sm.textContent=targetNavLabel;}
    var adminButton=document.getElementById('adminNavButton'); if(adminButton)adminButton.hidden=!isAdmin;var supportRoleButton=document.getElementById('supportRoleNavButton');if(supportRoleButton){supportRoleButton.hidden=!!isAdmin;var supportLabel=supportRoleButton.querySelector('small');if(supportLabel)supportLabel.textContent=settings.language==='en'?'Support':(settings.language==='kz'?'Қолдау':'Поддержка');supportRoleButton.classList.toggle('active',activeScreen==='support'&&!isAdmin);}
    var notificationButton=document.getElementById('notificationsButton');if(notificationButton)notificationButton.hidden=(currentRole==='none'&&!isAdmin);
    var markAllButton=document.getElementById('markAllReadButton');if(markAllButton)markAllButton.hidden=(activeScreen!=='notifications'||(currentRole==='none'&&!isAdmin));
    navEl.classList.toggle('admin-nav',!!isAdmin);
    var count=Array.from(navEl.querySelectorAll('button[data-screen]')).filter(function(b){return !b.hidden;}).length;
    var navGrid='repeat('+Math.max(count,1)+',minmax(0,1fr))';
    if(navEl.style.gridTemplateColumns!==navGrid)navEl.style.gridTemplateColumns=navGrid;
    navEl.querySelectorAll('button[data-screen]').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-screen')===activeScreen&&!b.hidden);});
    var desktopLabels={
      ru:{home:'Главная',prices:'Прайсы',subscription:'Подписка',settings:'Настройки',admin:'Админ-панель',notifications:'Уведомления',search:'Поиск товаров',support:'Поддержка'},
      en:{home:'Home',prices:'Price lists',subscription:'Subscription',settings:'Settings',admin:'Admin panel',notifications:'Notifications',search:'Product search',support:'Support'},
      kz:{home:'Басты',prices:'Прайс-парақтар',subscription:'Жазылым',settings:'Баптаулар',admin:'Әкімші панелі',notifications:'Хабарландырулар',search:'Тауарларды іздеу',support:'Қолдау'}
    };
    var navText=desktopLabels[settings.language]||desktopLabels.ru;
    ['desktopSidebar','desktopCompactNav'].forEach(function(id){
      var root=document.getElementById(id);if(!root)return;
      root.querySelectorAll('button[data-screen]').forEach(function(b){
        var screen=b.getAttribute('data-screen');
        if(screen==='admin')b.hidden=!isAdmin;
        if(id==='desktopSidebar'&&screen==='prices')b.hidden=(currentRole==='buyer');
        if(id==='desktopCompactNav'&&screen==='prices'&&currentRole==='buyer')b.setAttribute('data-screen','search');
        var label=b.querySelector('span');if(label)label.textContent=navText[screen]||label.textContent;
        b.classList.toggle('active',screen===activeScreen&&!b.hidden);
      });
    });
    // Desktop moves the labeled action into the notifications content toolbar;
    // Telegram WebApp keeps the icon-only action in its header, immediately before the bell.
    syncMarkAllReadButtonPlacement();
    if(!window.__bpMarkAllPlacementResize){window.__bpMarkAllPlacementResize=true;window.addEventListener('resize',syncMarkAllReadButtonPlacement,{passive:true});}
    var unread=document.getElementById('unreadDot'),sidebarUnread=document.getElementById('desktopUnreadDot');
    if(sidebarUnread)sidebarUnread.classList.toggle('on',!!(unread&&unread.classList.contains('on')));
    var currentLabel=navText[activeScreen]||navText.home;
    var crumb=document.getElementById('desktopCurrentSection');if(crumb)crumb.textContent=currentLabel;
  }
  function updateDesktopBreadcrumb(screen){ activeScreen=screen||activeScreen; configureRoleNavigation(); }
  function showScreenLoading(){
    if(document.body.classList.contains('external-open'))return;
    document.body.classList.toggle('bp-loading-settings',activeScreen==='settings');
    var scrollbarWidth=Math.max(0,window.innerWidth-document.documentElement.clientWidth);
    document.documentElement.style.setProperty('--bp-scrollbar-width',scrollbarWidth+'px');
    var desktopWide=isDesktopWideShell();
    var overlay=document.getElementById('screenLoadingOverlay');
    if(overlay&&overlay._bpRemovalTimer){window.clearTimeout(overlay._bpRemovalTimer);overlay._bpRemovalTimer=null;}
    if(!overlay){
      overlay=document.createElement('div');
      overlay.id='screenLoadingOverlay';
      overlay.className=desktopWide?'desktop-screen-loading-overlay':'mobile-content-loading-overlay';
      overlay.innerHTML='<section class="loading-card desktop-catalog-loading" role="status" aria-label="Загрузка раздела"><div class="dot-matrix-loader" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><p>'+localizeUiText('Загружаем раздел…','Loading section…','Бөлім жүктелуде…')+'</p></section>';
      document.body.appendChild(overlay);
    }
    overlay.classList.toggle('desktop-screen-loading-overlay',desktopWide);
    overlay.classList.toggle('mobile-content-loading-overlay',!desktopWide);
    if(desktopWide){
      // Place the desktop loader just below the page heading/subtitle instead of
      // vertically centering it in the entire content workspace.
      var overlayRect=overlay.getBoundingClientRect();
      var appRoot=document.getElementById('app');
      var anchor=appRoot&&(appRoot.querySelector('.subtitle')||appRoot.querySelector('.page-title'));
      var anchorBottom=anchor?anchor.getBoundingClientRect().bottom:NaN;
      var loaderOffset=isFinite(anchorBottom)?Math.max(24,Math.round(anchorBottom-overlayRect.top+22)):150;
      overlay.style.setProperty('--bp-desktop-loader-offset',loaderOffset+'px');
    }else{
      overlay.style.removeProperty('--bp-desktop-loader-offset');
    }
    overlay.classList.add('is-visible');
  }
  function hideScreenLoading(){var overlay=document.getElementById('screenLoadingOverlay');if(overlay){overlay.classList.remove('is-visible');if(overlay._bpRemovalTimer)window.clearTimeout(overlay._bpRemovalTimer);overlay._bpRemovalTimer=window.setTimeout(function(){if(overlay&&!overlay.classList.contains('is-visible')&&overlay.parentNode)overlay.parentNode.removeChild(overlay);},220);}document.body.classList.remove('bp-loading-settings');}
  function revealUiChrome(){
    installDesktopModalCloseButtons();
    document.documentElement.classList.remove('ui-boot-pending');
    var shell=document.querySelector('.app-shell');if(shell)shell.style.visibility='';
    var bootVeil=document.getElementById('bootBlurOverlay');
    if(bootVeil){bootVeil.classList.remove('is-visible');window.setTimeout(function(){if(bootVeil.isConnected)bootVeil.remove();},280);}
  }

  function applyTheme() {
    var root=document.body; var mode=settings.appearance==='light'?'light':'dark'; settings.appearance=mode;
    // Preserve system-lock-mode and other page state classes while changing colors.
    root.classList.toggle('light',mode==='light');
    ['mono','ocean','forest','rose','amber'].forEach(function(themeName){root.classList.remove('theme-'+themeName);});
    if(settings.theme && settings.theme!=='mono')root.classList.add('theme-'+settings.theme);
    if(!settingsDraftActive){try { var storageKey=appearanceStorageKey(); if(storageKey)localStorage.setItem(storageKey,JSON.stringify({language:settings.language,theme:settings.theme,appearance:mode})); } catch (appearanceWriteError) {}}
    updateLocalizedDocumentTitle(activeScreen);
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
  function screenHref(screen){
    if(browserSessionActive && !initData){
      var routeRoot=browserMobileMode?'/m/':'/';
      if(screen==='best')return routeRoot+'search?mode=best';
      var routes={home:'home',prices:'prices',subscription:'subscription',settings:'settings',admin:'admin',search:'search',notifications:'notifications',support:'support'};
      return routeRoot+(routes[screen]||'home');
    }
    if(screen==='best')return '/search.html?mode=best';
    var files={home:'/index.html',prices:'/prices.html',subscription:'/subscription.html',settings:'/settings.html',admin:'/admin.html',search:'/search.html',notifications:'/notifications.html',support:'/support.html'};
    return files[screen]||'/index.html';
  }
  function canonicalBrowserRoute(){
    var path=window.location.pathname||'/';
    var routes={'/':'home','/index.html':'home','/mobile/index.html':'home','/index.php':'home','/home':'home','/home/':'home',
      '/prices.html':'prices','/prices.php':'prices','/prices':'prices','/prices/':'prices',
      '/subscription.html':'subscription','/subscription.php':'subscription','/subscription':'subscription','/subscription/':'subscription',
      '/settings.html':'settings','/settings.php':'settings','/settings':'settings','/settings/':'settings',
      '/admin.html':'admin','/admin.php':'admin','/admin':'admin','/admin/':'admin',
      '/search.html':'search','/search.php':'search','/search':'search','/search/':'search',
      '/notifications.html':'notifications','/notifications.php':'notifications','/notifications':'notifications','/notifications/':'notifications',
      '/notification.html':'notifications','/notification.php':'notifications','/notification':'notifications','/notification/':'notifications',
      '/support.html':'support','/support.php':'support','/support':'support','/support/':'support'};
    var mobileMatch=path.match(/^\/m\/(home|prices|subscription|settings|admin|search|notifications|support)\/?$/);
    var screen=mobileMatch?mobileMatch[1]:routes[path];
    if(!screen)screen='home';
    var clean=(browserMobileMode?'/m/':'/')+screen;
    var query=new URLSearchParams(window.location.search||'');
    var params=new URLSearchParams();
    if(screen==='search'&&query.get('mode')==='best')params.set('mode','best');
    ['bp_tg_error','bp_tg_detail','bp_tg_login'].forEach(function(key){if(query.has(key))params.set(key,query.get(key));});
    return clean+(params.toString()?'?'+params.toString():'');
  }
  function nav(screen) {
    if(currentRole==='buyer'&&screen==='prices')screen='search';
    if(activeScreen==='settings'&&screen!=='settings'&&settingsDraftActive){settings=Object.assign({},savedSettings);settingsDraftActive=false;applyTheme();}
    var nextHref=screenHref(screen),currentHref=window.location.pathname+(window.location.search||'');
    if(browserSessionActive && !initData){if(currentHref!==nextHref){window.location.assign(nextHref);return;}}
    else {var currentFile=window.location.pathname.split('/').pop()+(window.location.search||'');if(currentFile!==nextHref){window.location.assign(nextHref);return;}}
    activeScreen=screen;document.querySelectorAll('.bottom-nav button').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-screen')===screen&&!b.hidden);});configureRoleNavigation();resetPageScroll();renderScreen(screen);
  }
  function load(action, extra, force) { if (!force && cache[action] && Date.now()-cache[action].time<20000) return Promise.resolve(cache[action].data); return api(action,extra).then(function(d){cache[action]={time:Date.now(),data:d};return d;}); }
  function heading(eyebrow,title,subtitle) { return '<p class="eyebrow">'+esc(eyebrow)+'</p><h1 class="page-title">'+esc(title)+'</h1>'+(subtitle?'<p class="subtitle">'+esc(subtitle)+'</p>':''); }
  function profileHero(o) {
    var p=o.profile||{}; var sub=o.subscription; var photo=avatarMarkup(p, 'profile-avatar', 'Аватар пользователя', true);
    var name=[p.first_name,p.last_name].filter(Boolean).join(' ')||'Пользователь Telegram'; var handle=p.username?'@'+p.username:'Telegram ID '+p.tg_id;
    var status=sub&&sub.active?'Подписка активна':'Подписка не активна';
    return '<section class="hero"><div class="hero-row">'+photo+'<div class="profile-identity"><div class="profile-name-marquee"><span class="profile-name-text">'+esc(name)+'</span></div><div class="profile-handle">'+esc(handle)+'</div></div><span class="status-label"><i class="dot" style="background:'+(sub&&sub.active?'var(--good)':'var(--warn)')+'"></i>'+status+'</span></div><div class="hero-bottom"><div><div class="label">Доступ до</div><div class="value" style="font-size:20px">'+(sub&&sub.available_until?esc(fmtDate(sub.available_until)):'—')+'</div></div><button class="button" data-go="subscription">Моя подписка '+iconSvg('arrow')+'</button></div></section>';
  }
  function renderHome() {
    var overviewPromise = overview ? Promise.resolve(overview) : load('overview',{},true);
    return overviewPromise.then(function(o){
      overview=o;profile=o.profile;isAdmin=!!o.is_admin;currentRole=o.role||o.profile.role||(isAdmin?'admin':'seller');currentPriceMultiplier=Number(o.profile.price_multiplier||1);botUsername=o.bot_username||botUsername;
      var unread=document.getElementById('unreadDot');if(unread)unread.classList.toggle('on',Number(o.unread_count)>0);var sideUnread=document.getElementById('desktopUnreadDot');if(sideUnread)sideUnread.classList.toggle('on',Number(o.unread_count)>0);applyTheme();
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
      if(!buyer)html+='<button class="action-card" data-go="prices"><span class="symbol">'+iconSvg('file')+'</span><span><strong>Прайс-листы</strong><small>Файлы и обработка</small></span></button>';
      html+='<button class="action-card '+(buyer?'buyer-search-wide':'')+'" data-go="search"><span class="symbol">'+iconSvg('search')+'</span><span><strong>Поиск товаров</strong><small>Фильтры и цены</small></span></button><button class="action-card" data-go="notifications"><span class="symbol">'+iconSvg('bell')+'</span><span><strong>Уведомления</strong><small>Обновления и статусы</small></span></button><button class="action-card" data-go="support"><span class="symbol">'+iconSvg('arrow')+'</span><span><strong>Поддержка</strong><small>FAQ и обратная связь</small></span></button></div>';
      app.innerHTML=translateHtml(html);configureRoleNavigation();initProfileNameMarquee();var favoritesTrigger=app.querySelector('[data-open-favorites]');if(favoritesTrigger)favoritesTrigger.onclick=openFavoritesModal;return html;
    });
  }
  function initProfileNameMarquee(){
    var box=document.querySelector('.profile-name-marquee'),text=box&&box.querySelector('.profile-name-text');if(!box||!text)return;
    box.classList.remove('is-long');text.style.removeProperty('--marquee-distance');
    requestAnimationFrame(function(){if(text.scrollWidth>box.clientWidth+2){box.classList.add('is-long');text.style.setProperty('--marquee-distance',Math.max(0,text.scrollWidth-box.clientWidth+22)+'px');}});
  }
  function bindSheetDrag(overlay, modal) {
    if(!overlay||!modal)return;
    // Desktop browser dialogs behave like conventional dialogs, not mobile bottom sheets.
    if(isDesktopWideShell())return;
    var grab=modal.querySelector('.modal-grab');if(!grab||!window.PointerEvent)return;
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
    overlay.innerHTML='<section class="filter-modal boost-modal" role="dialog" aria-modal="true" aria-labelledby="boostTitle"><div class="modal-grab" aria-label="'+localizeUiText('Потяните, чтобы закрыть','Drag to close','Жабу үшін тартыңыз')+'"><span></span></div><div class="modal-content"><div class="modal-head"><div><div class="eyebrow">ЦЕНЫ ПРОДАВЦА</div><h2 id="boostTitle">Множитель цены</h2><p class="tiny muted">Базовая цена умножается на выбранное значение в каталоге.</p></div></div><div class="filter-tabs boost-tabs" data-active-tab="filters"><button type="button" class="filter-tab active" data-boost-mode="analog">'+localizeUiText('Аналог','Dial','Таңдау')+'</button><button type="button" class="filter-tab" data-boost-mode="keyboard">Клавиатура</button></div><section data-boost-panel="analog"><div class="boost-wheel-shell"><div class="boost-wheel-fade top"></div><div class="boost-wheel" tabindex="0" aria-label="'+localizeUiText('Выбор множителя','Choose multiplier','Көбейткішті таңдау')+'"></div><div class="boost-wheel-fade bottom"></div><div class="boost-wheel-selection"></div></div></section><section data-boost-panel="keyboard" hidden><div class="boost-adjust-row"><button type="button" class="mini-button" data-boost-delta="0.1">+0.1</button><button type="button" class="mini-button" data-boost-delta="0.5">+0.5</button><button type="button" class="mini-button" data-boost-delta="1">+1</button><button type="button" class="mini-button" data-boost-delta="2.5">+2.5</button><button type="button" class="mini-button" data-boost-delta="10">+10</button></div><input class="input boost-number" data-boost-input type="number" min="0.1" max="100" step="0.1" inputmode="decimal"><div class="boost-adjust-row"><button type="button" class="mini-button" data-boost-delta="-0.1">−0.1</button><button type="button" class="mini-button" data-boost-delta="-0.5">−0.5</button><button type="button" class="mini-button" data-boost-delta="-1">−1</button><button type="button" class="mini-button" data-boost-delta="-2.5">−2.5</button><button type="button" class="mini-button" data-boost-delta="-10">−10</button></div></section><div class="boost-preview card"><span class="tiny muted">Текущий множитель</span><strong data-boost-value></strong><span class="tiny muted">Например, 10 USD → <b data-boost-example></b></span></div></div><div class="modal-actions"><button class="button" data-boost-save>Сохранить буст</button></div></section>';
    overlay.innerHTML=translateHtml(overlay.innerHTML);
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
    var desktopAnalogWheel=isDesktopWideShell();
    var wheelSnapTimer=0;
    if(desktopAnalogWheel){
      // Desktop uses the browser's native wheel scrolling: no mouse-drag gesture and no visible scrollbar.
      wheel.addEventListener('scroll',function(){updateWheelValue();if(wheelSnapTimer)clearTimeout(wheelSnapTimer);wheelSnapTimer=window.setTimeout(function(){wheelSnapTimer=0;snapWheel();},110);},{passive:true});
      wheel.addEventListener('keydown',function(event){if(event.key==='ArrowDown'||event.key==='PageDown'){event.preventDefault();useWheelIndex(index+(event.key==='PageDown'?10:1),true);}else if(event.key==='ArrowUp'||event.key==='PageUp'){event.preventDefault();useWheelIndex(index-(event.key==='PageUp'?10:1),true);}else if(event.key==='Home'){event.preventDefault();useWheelIndex(0,true);}else if(event.key==='End'){event.preventDefault();useWheelIndex(vals.length-1,true);}});
    }else{
      wheel.addEventListener('pointerdown',function(e){if(e.pointerType==='mouse'&&e.button!==0)return;stopWheelInertia();dragState={pointerId:e.pointerId,startY:e.clientY,lastY:e.clientY,startScroll:wheel.scrollTop,lastTime:e.timeStamp,velocity:0,moved:false};wheel.classList.add('is-dragging');try{wheel.setPointerCapture(e.pointerId);}catch(err){}});
      wheel.addEventListener('pointermove',function(e){if(!dragState||dragState.pointerId!==e.pointerId)return;var dy=e.clientY-dragState.lastY,dt=Math.max(1,e.timeStamp-dragState.lastTime);if(Math.abs(e.clientY-dragState.startY)>3)dragState.moved=true;if(dragState.moved){e.preventDefault();wheel.scrollTop=dragState.startScroll-(e.clientY-dragState.startY);dragState.velocity=dragState.velocity*.62+(-dy/dt)*.38;updateWheelValue();}dragState.lastY=e.clientY;dragState.lastTime=e.timeStamp;});
      function endWheelDrag(e){if(!dragState||dragState.pointerId!==e.pointerId)return;var state=dragState;dragState=null;wheel.classList.remove('is-dragging');if(state.moved){suppressWheelClick=true;window.setTimeout(function(){suppressWheelClick=false;},0);startWheelInertia(state.velocity);}else snapWheel();}
      wheel.addEventListener('pointerup',endWheelDrag);wheel.addEventListener('pointercancel',endWheelDrag);wheel.addEventListener('lostpointercapture',function(){if(dragState){var state=dragState;dragState=null;wheel.classList.remove('is-dragging');if(state.moved)startWheelInertia(state.velocity);else snapWheel();}});
      wheel.addEventListener('wheel',function(e){e.preventDefault();},{passive:false});
    }
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
  function renderPrices(prefetchedFiles,prefetchedOverview) {
    if(currentRole==='buyer'){nav('search');return Promise.resolve();}
    var requests=arguments.length?Promise.all([Promise.resolve(prefetchedFiles),Promise.resolve(prefetchedOverview||overview)]):Promise.all([load('files',{},true),Promise.resolve(overview||load('overview',{},true))]);
    return requests.then(function(all){
      var files=all[0],o=all[1],webUploadEnabled=true;
      trackPriceFileTransitions(files);
      currentRole=o.role||o.profile.role||currentRole;
      if(currentRole==='buyer'){nav('search');return;}
      currentPriceMultiplier=Number(o.profile.price_multiplier||1);
      var html=heading('РАБОТА С ДАННЫМИ','Прайс-листы','Загружайте исходные Excel и CSV-файлы, обрабатывайте их и управляйте каталогом в одном месте.');
      if(webUploadEnabled){
        html+='<section class="card web-upload-card"><div class="row"><div><div class="card-title">Загрузить прайс-лист</div><div class="tiny muted">Excel (.xls, .xlsx) или CSV · до 20 МБ на файл</div></div><div class="file-icon excel-file-icon">'+excelIconSvg()+'</div></div><label class="web-upload-drop" id="webUploadDrop" for="priceListFileInput"><span class="web-upload-symbol">'+iconSvg('upload')+'</span><strong>Выберите файл или перетащите сюда</strong><small id="priceListFileName">Файл пока не выбран</small><input id="priceListFileInput" type="file" accept=".xls,.xlsx,.csv" multiple hidden></label><p class="tiny muted web-upload-status" id="webUploadStatus" aria-live="polite">После загрузки сервер проверит совпадения с уже сохранёнными прайс-листами.</p><button type="button" class="button full" id="uploadPriceFile" disabled><span id="uploadPriceFileLabel">Загрузить и обработать</span></button><div class="tiny muted web-upload-note">Файлы сохраняются в приватном каталоге и обрабатываются серверной очередью Basalt Perfume.</div></section>';
      }else{
        html+='<div class="card"><div class="row"><div><div class="card-title">Добавить новый прайс</div><div class="tiny muted">Выберите один или несколько Excel/CSV-файлов на этой странице. После обработки данные появятся здесь.</div></div><div class="file-icon excel-file-icon">'+excelIconSvg()+'</div></div><div class="divider"></div><a class="button full telegram-link" id="openBot" href="'+esc(botUrl('webapp') || '#')+'" target="_blank" rel="noopener noreferrer">Открыть чат с ботом '+iconSvg('arrow')+'</a></div>';
      }
      html+='<div class="section-head"><h2>Ваши файлы</h2><span class="status-label section-count">Всего: '+files.length+'</span></div>';
      if(!files.length){html+='<div class="empty"><div class="symbol">'+iconSvg('file')+'</div><strong>Каталог пока пуст</strong><p class="tiny">'+(webUploadEnabled?'Загрузите первый прайс-лист через форму выше.':'Добавьте первый прайс-лист с помощью формы загрузки на этой странице.')+'</p>'+(webUploadEnabled?'':'<a class="button secondary telegram-link" id="openBotEmpty" href="'+esc(botUrl('webapp') || '#')+'" target="_blank" rel="noopener noreferrer">Перейти к боту</a>')+'</div>';}
      else{
        var readyFiles=files.filter(function(f){return f.status==='ready';});
        html+='<div class="file-list">';
        files.forEach(function(f){
          var ready=f.status==='ready',reviewCount=Number(f.review_count||0);
          var reviewLabel=reviewCount?(settings.language==='en'?' · Possibly '+reviewCount+' inaccuracies':(settings.language==='kz'?' · '+reviewCount+' ықтимал дәлсіздік':' · Возможно '+reviewCount+' неточностей')):'';
          var download=ready?'<button type="button" class="mini-button" data-web-download="'+Number(f.id)+'" data-download-name="'+esc(f.filename)+'">Скачать</button>':'';
          var fileState=ready?iconSvg('check')+' '+esc(translateHtml('Обработан')):esc(fileStatusLabel(f.status));
          if(f.status==='pending'&&Number(f.queue_wait_seconds||0)>180)fileState+=' · '+esc(localizeUiText('Задание ожидает обработки более 3 минут — проверьте очередь и cron','Job has waited over 3 minutes — check the queue and cron','Тапсырма 3 минуттан астам күтуде — кезек пен cron тексеріңіз'));
          if(f.status==='processing'&&Number(f.queue_attempts||0)>0){fileState+=' · '+esc(localizeUiText('Попытка ','Attempt ','Әрекет '))+Number(f.queue_attempts);if(Number(f.queue_heartbeat_age||0)>120)fileState+=' · '+esc(localizeUiText('Нет связи с обработчиком более 2 минут','No worker heartbeat for over 2 minutes','Өңдеу қызметімен байланыс 2 минуттан астам жоқ'));else fileState+=' · '+esc(localizeUiText('Обработчик активен','Worker active','Өңдеу қызметі белсенді'));}
          html+='<article class="file-card"><div class="file-icon excel-file-icon">'+excelIconSvg()+'</div><div class="file-info"><div class="file-name">'+esc(f.filename)+'</div><div class="file-meta">'+fmtSize(f.size_bytes)+' · '+Number(f.product_count||0)+' товаров · '+esc(fmtDate(f.imported_at))+'</div><div class="file-meta">'+fileState+reviewLabel+'</div>'+(f.status==='error'&&f.queue_error?'<div class="file-meta file-processing-error">'+esc(String(f.queue_error).slice(0,220))+'</div>':'')+'</div><div class="file-actions">'+download+'<button class="mini-button" data-delete-file="'+f.id+'">Удалить</button></div></article>';
        });
        html+='</div>';
        if(readyFiles.length>0)html+='<div class="download-all-wrap"><button type="button" class="button secondary" id="downloadAllFiles" data-download-all>'+localizeUiText('Скачать все','Download all','Барлығын жүктеу')+' ('+readyFiles.length+')</button></div>';
      }
      var boostDisabled=currentRole==='seller'&&!files.length;
      html+='<div class="section-head"><h2>Инструменты каталога</h2></div><div class="action-grid price-tools-grid"><button class="action-card" data-go="search"><span class="symbol">'+iconSvg('search')+'</span><span><strong>Поиск и фильтры</strong><small>Бренд, тип, цена и объём</small></span></button>'+((currentRole==='seller'||currentRole==='admin')?'<button class="action-card '+(boostDisabled?'is-disabled':'')+'" id="openPriceBoost" '+(boostDisabled?'disabled aria-disabled="true"':'')+'><span class="symbol">'+iconSvg('subscription')+'</span><span><strong>Буст цены</strong><small>'+(boostDisabled?'Добавьте прайс-лист, чтобы включить буст':'Множитель: '+currentPriceMultiplier.toFixed(2)+'×')+'</small></span></button>':'')+'</div>';
      app.innerHTML=translateHtml(html);
      bindFileButtons();bindOpenBot();bindWebPriceUpload();
      var boost=document.getElementById('openPriceBoost');if(boost&&!boost.disabled)boost.onclick=openPriceBoostModal;
      configureRoleNavigation();
      scheduleFileRefresh(files);
      return html;
    });
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
  function performFileDownload(url, filename){
    if(!url)return Promise.reject(new Error('download_link_failed'));
    var webApp=window.Telegram&&window.Telegram.WebApp?window.Telegram.WebApp:null;
    if(webApp&&typeof webApp.downloadFile==='function'){
      try{
        webApp.downloadFile({url:url,file_name:filename||'price-list.xlsx'},function(accepted){
          if(accepted===false)return;
        });
        return Promise.resolve();
      }catch(error){
        if(window.console&&console.warn)console.warn('Telegram native download unavailable; using browser fallback.');
      }
    }
    if(webApp&&typeof webApp.openLink==='function'){
      try{webApp.openLink(url);return Promise.resolve();}catch(openError){}
    }
    var link=document.createElement('a');link.href=url;link.download=filename||'';link.rel='noopener';link.style.display='none';document.body.appendChild(link);link.click();link.remove();
    return Promise.resolve();
  }
  function requestFileDownload(button, kind, fileId, userId, fallbackName){
    var originalDisabled=button?button.disabled:false;if(button)button.disabled=true;
    return window.BasaltApi.createDownloadLink(kind,fileId,initData,userId).then(function(result){
      return performFileDownload(result.url,result.filename||fallbackName||'price-list.xlsx');
    }).catch(function(error){toast(friendlyError(error));}).finally(function(){if(button&&button.isConnected)button.disabled=originalDisabled;});
  }
  function bindTimedDelete(button, action){
    var phase=0,left=5,timer=null,original=button.textContent;
    function reset(){if(timer){window.clearInterval(timer);timer=null;}phase=0;left=5;button.disabled=false;button.textContent=original;button.classList.remove('delete-confirm-ready');}
    button.onclick=function(){
      if(phase===0){phase=1;left=5;button.disabled=true;button.textContent=localizeUiText('Удалить (5)','Delete (5)','Жою (5)');
        timer=window.setInterval(function(){if(!button.isConnected){window.clearInterval(timer);timer=null;return;}left--;if(left<=0){window.clearInterval(timer);timer=null;button.disabled=false;button.classList.add('delete-confirm-ready');button.textContent=localizeUiText('Удалить','Delete','Жою');}else button.textContent=localizeUiText('Удалить (','Delete (','Жою (')+left+')';},1000);
        return;
      }
      if(button.disabled)return;button.disabled=true;button.textContent=localizeUiText('Удаление…','Deleting…','Жойылуда…');
      Promise.resolve().then(action).catch(function(error){toast(friendlyError(error));reset();});
    };
  }
  function bindFileButtons(){
    document.querySelectorAll('[data-download-all]').forEach(function(button){button.onclick=function(){requestFileDownload(button,'all',0,0,'basalt-price-lists.zip');};});
    document.querySelectorAll('[data-download-file]').forEach(function(link){link.onclick=function(event){event.preventDefault();var id=Number(link.getAttribute('data-download-file'));if(Number.isInteger(id)&&id>0)requestFileDownload(link,'file',id,0,link.getAttribute('data-download-name'));};});
    document.querySelectorAll('[data-web-download]').forEach(function(button){button.onclick=function(){var id=Number(button.getAttribute('data-web-download'));if(Number.isInteger(id)&&id>0)requestFileDownload(button,'file',id,0,button.getAttribute('data-download-name'));};});
    document.querySelectorAll('[data-delete-file]').forEach(function(b){bindTimedDelete(b,function(){var id=Number(b.getAttribute('data-delete-file'));return api('delete_file',{file_id:id}).then(function(){delete cache.files;delete cache.overview;toast('Прайс-лист удалён');return refreshOverviewSignals().then(function(){return renderScreen('prices',overview);});});});});
  }
  function bindWebPriceUpload(){
    var input=document.getElementById('priceListFileInput'),drop=document.getElementById('webUploadDrop'),button=document.getElementById('uploadPriceFile'),label=document.getElementById('uploadPriceFileLabel'),name=document.getElementById('priceListFileName'),status=document.getElementById('webUploadStatus');
    if(!input||!button)return;
    var selected=[],batchId=null,reviewPending=false,uploadBusy=false,scanActive=false,stageValue=0;
    function setLabel(value){if(label)label.textContent=value;else button.textContent=value;}
    function makeBatchId(){var bytes=new Uint8Array(16);try{window.crypto.getRandomValues(bytes);}catch(e){for(var i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);}return Array.prototype.map.call(bytes,function(value){return value.toString(16).padStart(2,'0');}).join('');}
    function resetProgress(){stageValue=0;button.classList.remove('is-uploading','is-scanning');button.style.removeProperty('--upload-progress');}
    function beginProgressStage(scanning){stageValue=0;button.classList.add('is-uploading');button.classList.toggle('is-scanning',!!scanning);button.style.setProperty('--upload-progress','0%');}
    function setProgress(value,scanning){stageValue=Math.max(0,Math.min(100,Number(value)||0));button.classList.add('is-uploading');button.classList.toggle('is-scanning',!!scanning);button.style.setProperty('--upload-progress',stageValue+'%');}
    function validate(files){var valid=[];Array.prototype.forEach.call(files||[],function(file){var ext=String(file.name||'').split('.').pop().toLowerCase();if(['xls','xlsx','csv'].indexOf(ext)<0){toast(file.name+': '+localizeUiText('неподдерживаемый формат','unsupported format','қолдау көрсетілмейтін пішім'));return;}if(file.size>20*1024*1024){toast(file.name+': '+localizeUiText('файл больше 20 МБ','file exceeds 20 MB','файл 20 МБ-тан үлкен'));return;}valid.push(file);});return valid;}
    function choose(files){if(uploadBusy||scanActive)return;if(batchId){api('cancel_upload_batch',{batch_id:batchId}).catch(function(){});batchId=null;reviewPending=false;}selected=validate(files);setLabel(localizeUiText('Загрузить и обработать','Upload and process','Жүктеу және өңдеу'));name.textContent=selected.length?selected.length+' '+localizeUiText('файл(ов) выбрано','file(s) selected','файл таңдалды')+' · '+selected.map(function(f){return f.name;}).join(', '):'Файл пока не выбран';button.disabled=!selected.length;status.textContent=selected.length?localizeUiText('Файлы будут загружены во временную область и проверены на совпадения до постановки в очередь.','Files will be staged and checked for conflicts before entering the processing queue.','Файлдар уақытша аймаққа жүктеліп, өңдеу кезегіне дейін сәйкестікке тексеріледі.'):localizeUiText('Выберите один или несколько файлов.','Choose one or more files.','Бір немесе бірнеше файл таңдаңыз.');resetProgress();}
    input.addEventListener('change',function(){choose(input.files);});
    if(drop){['dragenter','dragover'].forEach(function(eventName){drop.addEventListener(eventName,function(event){event.preventDefault();drop.classList.add('is-dragging');});});['dragleave','drop'].forEach(function(eventName){drop.addEventListener(eventName,function(event){event.preventDefault();drop.classList.remove('is-dragging');});});drop.addEventListener('drop',function(event){choose(event.dataTransfer&&event.dataTransfer.files);});}

    function pollReview(id){var attempt=0;status.textContent=localizeUiText('Сравниваем названия, содержимое и форматирование файлов…','Comparing file names, contents and formatting…','Файл атаулары, мазмұны және пішімделуі салыстырылуда…');beginProgressStage(true);button.disabled=true;return new Promise(function(resolve,reject){function poll(){attempt++;api('upload_review_status',{batch_id:id}).then(function(result){if(result.status==='review_ready'){setProgress(100,true);resolve(result);return;}if(result.status==='scanning'||result.status==='scan_pending'){var scanPercent=Math.max(0,Math.min(100,Number(result.scan_progress)||0));setProgress(scanPercent,true);}if(result.status==='scan_error'){var err=new Error(localizeUiText('Не удалось проверить файлы. Повторите проверку или отмените загрузку.','Could not check the files. Retry the check or cancel this upload.','Файлдарды тексеру мүмкін болмады. Қайталап көріңіз немесе жүктеуден бас тартыңыз.'));err.code='upload_scan_failed';reject(err);return;}if(result.status==='finalized'){var done=new Error('Загрузка уже завершена');done.code='upload_batch_closed';reject(done);return;}if(attempt>=180){var timeout=new Error('Проверка ещё выполняется. Можно нажать «Проверить ещё раз».');timeout.code='upload_scan_pending';reject(timeout);return;}window.setTimeout(poll,2000);}).catch(function(error){if(error&&error.code==='upload_batch_expired'){reject(error);return;}if(attempt>=180){error.code=error.code||'upload_scan_pending';reject(error);return;}window.setTimeout(poll,2500);});}poll();});}

    function openConflictModal(batch,files){
      var conflicts=(files||[]).filter(function(file){return file.conflict;});
      if(!conflicts.length)return Promise.resolve({});
      return new Promise(function(resolve){
        var old=document.getElementById('uploadConflictOverlay');if(old)old.remove();
        var overlay=document.createElement('div');overlay.id='uploadConflictOverlay';overlay.className='modal-backdrop upload-conflict-overlay';
        overlay.innerHTML=translateHtml('<section class="filter-modal upload-conflict-modal" role="dialog" aria-modal="true" aria-labelledby="uploadConflictTitle"><div class="modal-grab"><span></span></div><div class="modal-content"><div class="eyebrow">BASALT · PRICE LISTS</div><h2 id="uploadConflictTitle">Обнаружены похожие файлы</h2><p class="tiny muted upload-conflict-intro">Перетащите каждый файл в нужную колонку. По умолчанию выбран вариант «Отмена».</p><div class="upload-conflict-board"><section class="upload-conflict-zone is-cancel" data-upload-zone="cancel"><header><strong>Отмена</strong><span class="upload-conflict-count" data-zone-count="cancel">0</span></header><div class="upload-conflict-list" data-zone-list="cancel"></div><small>Файл не будет обработан и будет удалён из временной загрузки</small></section><section class="upload-conflict-zone is-replace" data-upload-zone="replace"><header><strong>Замена</strong><span class="upload-conflict-count" data-zone-count="replace">0</span></header><div class="upload-conflict-list" data-zone-list="replace"></div><small>Старая версия будет заменена после успешной обработки новой</small></section></div></div><div class="modal-actions upload-conflict-actions"><button type="button" class="button" id="confirmUploadConflictChoices">Применить решения</button></div></section>');
        document.body.appendChild(overlay);
        var lists={cancel:overlay.querySelector('[data-zone-list="cancel"]'),replace:overlay.querySelector('[data-zone-list="replace"]')};var floatingCards=[];
        function reasonText(reasons){var labels=[];(reasons||[]).forEach(function(reason){if(reason==='name')labels.push(localizeUiText('Имя','Name','Атау'));else if(reason==='content')labels.push(localizeUiText('Содержимое','Content','Мазмұн'));else if(reason==='formatting')labels.push(localizeUiText('Содержимое + форматирование','Content + formatting','Мазмұн + пішімдеу'));});return labels.join(' · ');}
        conflicts.forEach(function(file){var card=document.createElement('article');card.className='upload-conflict-file';card.dataset.token=String(file.token);card.dataset.choice='cancel';card.setAttribute('role','group');card.setAttribute('aria-label',file.filename);var rows=file.row_count==null?'—':Number(file.row_count).toLocaleString();var match=reasonText(file.match_reasons);var oldNames=(file.existing_names||[]).length?'<small class="upload-conflict-existing">'+esc(localizeUiText('Совпадает с: ','Matches: ','Сәйкес файл: ')+file.existing_names.join(', '))+'</small>':'';card.innerHTML='<span class="upload-conflict-grip" aria-hidden="true">⠿</span><div class="upload-conflict-file-info"><strong>'+esc(file.filename)+'</strong><span>'+esc(localizeUiText('Строк: ','Rows: ','Жолдар: ')+rows)+' · '+esc(localizeUiText('Вес: ','Size: ','Көлемі: ')+fmtSize(Number(file.size_bytes||0)))+'</span>'+(match?'<small>'+esc(match)+'</small>':'')+oldNames+'</div>';lists.cancel.appendChild(card);});
        function renderCounts(){['cancel','replace'].forEach(function(zone){var count=lists[zone].querySelectorAll('.upload-conflict-file').length;var node=overlay.querySelector('[data-zone-count="'+zone+'"]');if(node)node.textContent=String(count);});}
        renderCounts();
        var settled=false,activeDrags=0,confirmButton=overlay.querySelector('#confirmUploadConflictChoices');function finish(value){if(settled)return;settled=true;document.removeEventListener('keydown',onKey);floatingCards.forEach(function(card){if(card&&card.isConnected)card.remove();});if(overlay.isConnected)overlay.remove();resolve(value);}
        function onKey(event){if(event.key==='Escape'){event.preventDefault();finish(null);}}
        document.addEventListener('keydown',onKey);
        overlay.addEventListener('click',function(event){if(event.target===overlay)finish(null);});
        var cancelBatchButton=overlay.querySelector('#cancelUploadConflictBatch');if(cancelBatchButton)cancelBatchButton.onclick=function(){finish(null);};
        confirmButton.onclick=function(){var choices={};overlay.querySelectorAll('.upload-conflict-file').forEach(function(card){choices[card.dataset.token]=card.dataset.choice==='replace'?'replace':'cancel';});finish(choices);};
        function overlapRatio(rect,zoneRect){var left=Math.max(rect.left,zoneRect.left),right=Math.min(rect.right,zoneRect.right),top=Math.max(rect.top,zoneRect.top),bottom=Math.min(rect.bottom,zoneRect.bottom);var area=Math.max(0,right-left)*Math.max(0,bottom-top);return area/Math.max(1,rect.width*rect.height);}
        function targetFor(rect){var cancelZone=overlay.querySelector('[data-upload-zone="cancel"]'),replaceZone=overlay.querySelector('[data-upload-zone="replace"]');var cr=cancelZone.getBoundingClientRect(),rr=replaceZone.getBoundingClientRect();var co=overlapRatio(rect,cr),ro=overlapRatio(rect,rr);if(ro>0.5)return 'replace';if(co>0.5)return 'cancel';var cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;var dc=Math.pow(cx-(cr.left+cr.width/2),2)+Math.pow(cy-(cr.top+cr.height/2),2);var dr=Math.pow(cx-(rr.left+rr.width/2),2)+Math.pow(cy-(rr.top+rr.height/2),2);return dr<dc?'replace':'cancel';}
        overlay.querySelectorAll('.upload-conflict-file').forEach(function(card){card.addEventListener('pointerdown',function(event){if(event.pointerType==='mouse'&&event.button!==0)return;if(settled)return;event.preventDefault();activeDrags++;confirmButton.disabled=true;try{card.setPointerCapture(event.pointerId);}catch(captureError){}var start=card.getBoundingClientRect(),offsetX=event.clientX-start.left,offsetY=event.clientY-start.top;card.classList.add('is-dragging');card.style.position='fixed';card.style.left=start.left+'px';card.style.top=start.top+'px';card.style.width=start.width+'px';card.style.zIndex='20000';card.style.margin='0';document.body.appendChild(card);floatingCards.push(card);function move(e){card.style.left=(e.clientX-offsetX)+'px';card.style.top=(e.clientY-offsetY)+'px';var current=card.getBoundingClientRect(),target=targetFor(current);overlay.querySelectorAll('.upload-conflict-zone').forEach(function(zone){zone.classList.toggle('is-drop-target',zone.dataset.uploadZone===target);});}function up(){document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',up);overlay.querySelectorAll('.upload-conflict-zone').forEach(function(zone){zone.classList.remove('is-drop-target');});var current=card.getBoundingClientRect(),choice=targetFor(current),targetList=lists[choice],listRect=targetList.getBoundingClientRect(),lastCard=targetList.querySelector('.upload-conflict-file:last-child'),lastRect=lastCard?lastCard.getBoundingClientRect():null,left=listRect.left+listRect.width/2-current.width/2,top=lastRect?lastRect.bottom+8:listRect.top;card.style.transition='left 260ms cubic-bezier(.18,.82,.24,1), top 260ms cubic-bezier(.18,.82,.24,1), box-shadow 180ms ease';card.style.left=left+'px';card.style.top=top+'px';window.setTimeout(function(){if(settled)return;card.style.transition='';card.style.position='';card.style.left='';card.style.top='';card.style.width='';card.style.zIndex='';card.style.margin='';card.classList.remove('is-dragging');card.dataset.choice=choice;lists[choice].appendChild(card);var floatIndex=floatingCards.indexOf(card);if(floatIndex!==-1)floatingCards.splice(floatIndex,1);activeDrags=Math.max(0,activeDrags-1);confirmButton.disabled=activeDrags>0;renderCounts();},280);}document.addEventListener('pointermove',move,{passive:false});document.addEventListener('pointerup',up,{passive:false});document.addEventListener('pointercancel',up,{passive:false});});});
        window.setTimeout(function(){if(overlay.isConnected)overlay.classList.add('is-open');},10);
      });
    }
    function finalizeBatch(id,choices){status.textContent=localizeUiText('Сохраняем выбранные решения и ставим файлы в очередь…','Saving choices and adding files to the queue…','Таңдалған шешімдер сақталып, файлдар кезекке қосылуда…');beginProgressStage(false);button.disabled=true;return api('finalize_upload_batch',{batch_id:id,choices:choices||{}}).then(function(result){setProgress(100,false);(result.queued||[]).forEach(function(item){if(item&&item.file_id)priceFileStatusExpectedIds[String(item.file_id)]=true;});var accepted=(result.queued||[]).map(function(item){return item.filename;});if(accepted.length)api('upload_accepted_notification',{files:accepted}).then(refreshOverviewSignals).catch(function(err){console.warn('Could not save upload acceptance notification',err);});batchId=null;reviewPending=false;selected=[];input.disabled=false;input.value='';button.disabled=true;setLabel(localizeUiText('Загрузить и обработать','Upload and process','Жүктеу және өңдеу'));name.textContent=accepted.length?accepted.join(', '):localizeUiText('Конфликтные файлы отменены','Conflicting files cancelled','Қайшылықты файлдардан бас тартылды');status.textContent=accepted.length?localizeUiText('Файлы добавлены в очередь обработки. Старые версии будут заменены только после успешного разбора.','Files were queued. Old versions will be replaced only after successful parsing.','Файлдар өңдеу кезегіне қосылды. Ескі нұсқалар тек сәтті өңдеуден кейін ауыстырылады.'):localizeUiText('Все конфликтные файлы отменены. Временные загрузки удалены.','All conflicting files were cancelled. Temporary uploads were removed.','Барлық қайшылықты файлдардан бас тартылды. Уақытша жүктемелер жойылды.');resetProgress();delete cache.files;delete cache.overview;window.setTimeout(function(){if(activeScreen==='prices')renderPrices();},700);return result;});}

    function handleReview(id,review){var conflicts=(review.files||[]).filter(function(file){return file.conflict;});if(!conflicts.length)return finalizeBatch(id,{});return openConflictModal(id,review.files).then(function(choices){if(choices===null){return api('cancel_upload_batch',{batch_id:id}).catch(function(){}).then(function(){batchId=null;reviewPending=false;selected=[];input.disabled=false;button.disabled=true;setLabel(localizeUiText('Загрузить и обработать','Upload and process','Жүктеу және өңдеу'));name.textContent=localizeUiText('Загрузка отменена','Upload cancelled','Жүктеуден бас тартылды');status.textContent=localizeUiText('Временные файлы удалены.','Temporary files were removed.','Уақытша файлдар жойылды.');resetProgress();});}return finalizeBatch(id,choices);});}
    function checkBatch(id){reviewPending=true;scanActive=true;input.disabled=true;button.disabled=true;setLabel(localizeUiText('Проверяем совпадения…','Checking conflicts…','Сәйкестіктер тексерілуде…'));return api('request_upload_scan',{batch_id:id}).catch(function(){}).then(function(){return pollReview(id);}).then(function(review){scanActive=false;return handleReview(id,review);}).catch(function(error){if(error&&error.code==='upload_scan_pending'){scanActive=true;button.disabled=false;setLabel(localizeUiText('Проверить ещё раз','Check again','Қайта тексеру'));status.textContent=error.message;return;}if(error&&error.code==='upload_scan_failed'){scanActive=false;resetProgress();input.disabled=false;button.disabled=false;setLabel(localizeUiText('Повторить проверку','Retry check','Тексеруді қайталау'));status.textContent=error.message;toast(error.message);return;}scanActive=false;toast(friendlyError(error));resetProgress();input.disabled=false;button.disabled=false;setLabel(localizeUiText('Повторить проверку','Retry check','Тексеруді қайталау'));status.textContent=friendlyError(error);});}

    button.onclick=function(){if(previewModeActive){toast(localizeUiText('В режиме предпросмотра загрузка недоступна.','Uploads are unavailable in preview mode.','Алдын ала қарау режимінде жүктеу қолжетімсіз.'));return;}if(uploadBusy||button.disabled)return;if(reviewPending&&batchId){checkBatch(batchId);return;}if(!selected.length)return;var files=selected.slice();if(!batchId)batchId=makeBatchId();uploadBusy=true;button.disabled=true;input.disabled=true;setLabel(localizeUiText('Загружаем…','Uploading…','Жүктелуде…'));setProgress(0,false);status.textContent=localizeUiText('Загружаем файлы во временную область…','Uploading files to temporary storage…','Файлдар уақытша орынға жүктелуде…');var completed=0,failed=0,failedFiles=[],next=0,active=0,fileProgress=files.map(function(){return 0;});
      function update(){var percent=Math.round(100*fileProgress.reduce(function(sum,value){return sum+value;},0)/Math.max(1,files.length));setProgress(percent,false);status.textContent=localizeUiText('Загружено: ','Uploaded: ','Жүктелді: ')+completed+'/'+files.length+(failed?' · '+localizeUiText('ошибок: ','errors: ','қате: ')+failed:'');}
      function pump(){if(next>=files.length&&active===0){uploadBusy=false;input.disabled=false;input.value='';selected=failedFiles.slice();if(selected.length){input.disabled=false;button.disabled=false;setLabel(localizeUiText('Повторить неудачные файлы','Retry failed files','Сәтсіз файлдарды қайталау'));name.textContent=selected.map(function(f){return f.name;}).join(', ');status.textContent=localizeUiText('Часть файлов не загрузилась. Повторите отправку оставшихся; уже загруженные файлы сохранятся во временной группе.','Some files failed. Retry the remaining files; successful uploads stay in the temporary batch.','Кейбір файлдар жүктелмеді. Қалғандарын қайталаңыз; сәтті жүктелгендер уақытша топта қалады.');return;}input.disabled=true;name.textContent=localizeUiText('Файлы загружены. Проверяем совпадения…','Files uploaded. Checking conflicts…','Файлдар жүктелді. Сәйкестіктер тексерілуде…');checkBatch(batchId).catch(function(error){button.disabled=false;reviewPending=true;setLabel(localizeUiText('Проверить ещё раз','Check again','Қайта тексеру'));status.textContent=friendlyError(error);toast(friendlyError(error));});return;}while(active<2&&next<files.length){(function(file,index){next++;active++;window.BasaltApi.uploadFile(file,initData,function(percent){fileProgress[index]=percent;setProgress(100*fileProgress.reduce(function(sum,value){return sum+value;},0)/Math.max(1,files.length),false);status.textContent=file.name+': '+percent+'%';},batchId).then(function(){completed++;fileProgress[index]=100;}).catch(function(error){failed++;failedFiles.push(file);toast(file.name+': '+friendlyError(error));}).finally(function(){active--;update();pump();});})(files[next],next);}}
      pump();
    };
  }
  var priceRefreshInFlight=false;
  function scheduleFileRefresh(files){
    if(fileRefreshTimer){window.clearTimeout(fileRefreshTimer);fileRefreshTimer=null;}
    if(!files||!files.some(function(file){return file.status==='processing'||file.status==='pending';}))return;
    fileRefreshTimer=window.setTimeout(function(){fileRefreshTimer=null;if(activeScreen!=='prices'||document.hidden||priceRefreshInFlight)return;schedulePriceRefresh();},30000);
  }
  function schedulePriceRefresh(){
    if(priceRefreshInFlight||activeScreen!=='prices'||document.hidden)return;
    priceRefreshInFlight=true;
    load('files',{},true).then(function(files){
      if(activeScreen==='prices')return renderPrices(files,overview);
      return null;
    }).catch(function(){}).finally(function(){priceRefreshInFlight=false;});
  }
  function openSiteKeyActivationModal(){
    var old=document.getElementById('siteKeyActivationOverlay');if(old)old.remove();
    var overlay=document.createElement('div');overlay.id='siteKeyActivationOverlay';overlay.className='modal-backdrop';
    overlay.innerHTML=translateHtml('<section class="filter-modal modal-filter site-key-activation-modal" role="dialog" aria-modal="true" aria-labelledby="siteKeyActivationTitle"><div class="modal-grab"><span></span></div><div class="modal-content"><div class="eyebrow">BASALT · PREMIUM ACCESS</div><h2 id="siteKeyActivationTitle">Активация ключа</h2><p class="tiny muted">Введите полный ключ. После проверки срок подписки будет активирован или продлён в соответствии с параметрами ключа.</p><label class="filter-field"><span>Ключ активации</span><input class="input" id="siteActivationKeyInput" type="text" maxlength="100" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Ключ активации подписки"></label><div class="tiny muted" id="siteActivationFeedback" aria-live="polite"></div></div><div class="modal-actions"><button type="button" class="button" id="submitSiteActivationKey">Активировать</button><button type="button" class="button secondary" data-site-key-close>Отмена</button></div></section>');
    document.body.appendChild(overlay);var modal=overlay.querySelector('.site-key-activation-modal');bindSheetDrag(overlay,modal);
    function close(){if(!overlay.isConnected)return;overlay.classList.add('closing');window.setTimeout(function(){if(overlay.isConnected)overlay.remove();},220);document.removeEventListener('keydown',onKey);}
    function onKey(event){if(event.key==='Escape')close();}document.addEventListener('keydown',onKey);
    overlay.querySelectorAll('[data-site-key-close]').forEach(function(button){button.onclick=close;});overlay.addEventListener('click',function(event){if(event.target===overlay)close();});
    var input=overlay.querySelector('#siteActivationKeyInput'),submit=overlay.querySelector('#submitSiteActivationKey'),feedback=overlay.querySelector('#siteActivationFeedback');
    function activate(){var key=String(input.value||'').trim();if(key.length<8||key.length>100){feedback.textContent=localizeUiText('Проверьте ключ: допустимая длина — от 8 до 100 символов.','Check the key: it must be between 8 and 100 characters.','Кілтті тексеріңіз: ұзындығы 8-ден 100 таңбаға дейін болуы керек.');input.focus();return;}submit.disabled=true;input.disabled=true;feedback.textContent=localizeUiText('Проверяем ключ и активируем подписку…','Checking the key and activating your subscription…','Кілт тексеріліп, жазылым белсендірілуде…');api('activate_subscription_key',{key:key}).then(function(result){feedback.textContent=localizeUiText('Ключ успешно активирован. Обновляем срок подписки…','The key was activated. Updating your subscription…','Кілт сәтті белсендірілді. Жазылым мерзімі жаңартылуда…');delete cache.overview;delete cache.settings;overview=null;close();toast(result&&result.queued?localizeUiText('Ключ добавлен в очередь продления','Key added to the renewal queue','Кілт жазылымды ұзарту кезегіне қосылды'):localizeUiText('Подписка успешно активирована','Subscription activated successfully','Жазылым сәтті белсендірілді'));return load('overview',{},true);}).then(function(data){if(data){overview=data;profile=data.profile;isAdmin=!!data.is_admin;currentRole=data.role||'none';}subscriptionGateState=null;renderScreen('subscription');}).catch(function(error){feedback.textContent=friendlyError(error);submit.disabled=false;input.disabled=false;input.focus();});}
    submit.onclick=activate;input.addEventListener('keydown',function(event){if(event.key==='Enter'){event.preventDefault();activate();}});
    window.setTimeout(function(){if(overlay.isConnected){overlay.classList.add('is-open');}},10);
  }
  function renderSubscription(){return Promise.resolve(overview||load('overview',{},true)).then(function(o){
    var s=o.subscription||null;var secondsLeft=Number(s&&s.seconds_left||0);
    if((!isFinite(secondsLeft)||secondsLeft<=0)&&s&&s.available_until){var untilTs=Date.parse(String(s.available_until).replace(' ','T'));if(isFinite(untilTs))secondsLeft=Math.max(0,Math.floor((untilTs-Date.now())/1000));}
    var subActive=!!(s&&(s.active===true||Number(s.active)===1))&&secondsLeft>0;
    var days=subActive?Math.ceil(secondsLeft/86400):0;
    var activatedTs=s&&(s.starts_at||s.activated_at)?Date.parse(String(s.starts_at||s.activated_at).replace(' ','T')):NaN;var expiresTs=s&&s.available_until?Date.parse(String(s.available_until).replace(' ','T')):NaN;var measuredDuration=isFinite(activatedTs)&&isFinite(expiresTs)&&expiresTs>activatedTs?Math.floor((expiresTs-activatedTs)/1000):0;var durationSeconds=Math.max(1,measuredDuration||Number(s&&s.duration_seconds)||Number(s&&s.duration_days)*86400||secondsLeft||86400);
    var percent=subActive?Math.max(0,Math.min(100,secondsLeft/durationSeconds*100)):0;
    var html=heading('ДОСТУП И ТАРИФ','Ваша подписка','Управляйте сроком доступа и получайте напоминания до окончания подписки.');
    var subKeyParts=s&&s.key_prefix?String(s.key_prefix).toUpperCase().split(/[-–]/).filter(Boolean):[];var subKeyDisplay=subKeyParts.length?subKeyParts.slice(0,2).join('-'):'не активирован';
    html+='<section class="subscription-card"><div class="row"><span class="subscription-plan">BASALT · PREMIUM ACCESS</span><span class="status-label">'+(subActive?'Активна':'Не активна')+'</span></div><div class="subscription-status"><span class="status-dot"></span> '+(subActive?'Все функции доступны':'Требуется активация')+'</div><div class="subscription-time">'+(subActive?days+' '+(days===1?'день':(days>1&&days<5?'дня':'дней')):'Нет доступа')+'</div><div class="muted tiny">'+(s&&s.available_until?'Действует до '+fmtDate(s.available_until):'Активируйте ключ на сайте, чтобы начать работу.')+'</div><div class="progress" aria-label="Осталось '+percent.toFixed(0)+' процентов подписки"><span style="width:'+percent.toFixed(2)+'% !important;--subscription-progress:'+percent.toFixed(2)+'%;background:#fff;display:block;min-width:'+(subActive&&percent>0?'2px':'0')+'"></span></div><div class="row tiny muted"><span>Ключ: '+esc(subKeyDisplay)+'</span><span>'+(subActive?'Доступ открыт':'Ожидает активации')+'</span></div></section>';
    var queuedKeys=s&&Array.isArray(s.queued)?s.queued:[];
    if(queuedKeys.length){html+='<div class="section-head"><h2>Продление в очереди</h2><span class="status-label">'+queuedKeys.length+'</span></div><div class="card subscription-queue-card">'+queuedKeys.map(function(item,index){return '<div class="subscription-queue-row"><span class="subscription-queue-index">'+(index+1)+'</span><div class="subscription-queue-copy"><strong>'+esc(item.key_prefix||'Ключ подписки')+'</strong><small>Начало: '+esc(fmtDateTime(item.starts_at))+' · '+Number(item.duration_days||0)+' дней</small></div><span class="status-label">Ожидает</span></div>';}).join('<div class="divider"></div>')+'</div>';}
    html+='<div class="section-head"><h2>Что включено</h2></div><div class="card"><div class="setting-row"><div class="setting-icon">'+iconSvg('file')+'</div><div class="setting-copy"><strong>Неограниченный каталог прайс-листов</strong><small>Обработка файлов и единый список товаров</small></div><span class="feature-check">'+iconSvg('check')+'</span></div><div class="divider"></div><div class="setting-row"><div class="setting-icon">'+iconSvg('search')+'</div><div class="setting-copy"><strong>Поиск и сравнение цен</strong><small>Фильтры по бренду, типу и объёму</small></div><span class="feature-check">'+iconSvg('check')+'</span></div><div class="divider"></div><div class="setting-row"><div class="setting-icon">'+iconSvg('bell')+'</div><div class="setting-copy"><strong>Уведомления о сроке</strong><small>За 72 часа, затем каждые 24 часа до окончания</small></div><span class="feature-check">'+iconSvg('check')+'</span></div></div>';
    var siteKeyActivation=true;
    html+='<div class="card subscription-key-activation"><div class="card-title">Продлить доступ</div><p class="tiny muted">Введите ключ активации, чтобы продлить подписку. Проверка и продление выполняются на сайте.</p><button type="button" class="button full" id="openSiteKeyActivation">Ввести ключ активации</button></div>';app.innerHTML=translateHtml(html);var siteActivateButton=document.getElementById('openSiteKeyActivation');if(siteActivateButton)siteActivateButton.onclick=openSiteKeyActivationModal;return html;
  });}
  function renderSettings(){var settingsPromise=settingsDraftActive?Promise.resolve(settings):load('settings',{},false);return settingsPromise.then(function(s){if(!settingsDraftActive){settings=Object.assign({},s||settings);if(settings.appearance!=='dark'&&settings.appearance!=='light')settings.appearance='dark';savedSettings=Object.assign({},settings);}else{settings=Object.assign({},settings);}applyTheme();var html=heading('ПЕРСОНАЛИЗАЦИЯ','Настройки','Подстройте приложение под себя — от внешнего вида до уведомлений.');
    var pp=overview&&overview.profile?overview.profile:{};
    var desktopSettings=isDesktopWideShell();
    var ppAvatar=avatarMarkup(pp, desktopSettings?'profile-avatar profile-settings-avatar':'profile-settings-avatar', 'Аватар пользователя', desktopSettings);
    var ppName=pp.full_name||pp.name||[pp.first_name,pp.last_name].filter(Boolean).join(' ')||'Пользователь Telegram';
    var ppHandle=pp.username?'@'+pp.username:(desktopSettings?localizeUiText('Без username','No username','Пайдаланушы аты жоқ'):'Без username');
    var roleCode=String(currentRole||'none').toUpperCase();
    var ppRole=roleCode;
    var ppRoleClass=currentRole==='admin'?'admin':(currentRole==='buyer'?'buyer':(currentRole==='none'?'none':'user'));
    var mobileRoleLabel=roleCode;
    if(desktopSettings){
      html+='<section class="hero profile-settings-card profile-settings-card-desktop"><div class="hero-row">'+ppAvatar+'<div class="profile-identity"><div class="profile-name-marquee"><span class="profile-name-text">'+esc(ppName)+'</span></div><div class="profile-handle">'+esc(ppHandle)+' · Telegram ID '+esc(pp.tg_id||'—')+'</div></div><span class="role-badge '+ppRoleClass+'">'+ppRole+'</span></div></section>';
    }else{
      html+='<div class="card profile-settings-card"><div><div class="card-title">Профиль Telegram</div><div class="tiny muted">'+esc(ppHandle)+' · Telegram ID '+esc(pp.tg_id||'—')+'</div><div style="margin-top:9px"><span class="role-badge '+ppRoleClass+'">'+mobileRoleLabel+'</span></div></div>'+ppAvatar+'</div>';
    }
    html+='<div class="section-head appearance-section-head"><h2>'+localizeUiText('Оформление','Appearance','Безендіру')+'</h2></div>';
    html+='<div class="card appearance-settings-card"><div class="setting-row"><div class="setting-icon">'+iconSvg('globe')+'</div><div class="setting-copy"><strong>'+(desktopSettings?'Язык интерфейса':'Язык')+'</strong><small>Выберите язык приложения</small></div>'+customDropdown('languageSelect','language',[{value:'ru',label:'__BP_FIXED_RUSSIAN__'},{value:'en',label:'English'},{value:'kz',label:'Қазақша'}],settings.language)+'</div><div class="divider"></div><div class="row theme-title-row"><div><div class="card-title">Цветовая тема</div><div class="tiny muted">Монохромная по умолчанию</div></div></div><div class="theme-grid">'+themeChoice('mono','Mono','#f2f2f2','#141414')+themeChoice('ocean','Ocean','#9cd5f3','#16354a')+themeChoice('forest','Forest','#a8d6ae','#1c3b25')+themeChoice('rose','Rose','#efbdcb','#4a202d')+themeChoice('amber','Amber','#e9cf91','#4a3611')+'</div><div class="divider"></div><div class="setting-row"><div class="setting-icon">'+iconSvg('settings')+'</div><div class="setting-copy"><strong>Режим отображения</strong><small>Можно переключить любую тему на светлую или тёмную</small></div>'+customDropdown('appearanceSelect','appearance',[{value:'dark',label:'Тёмный'},{value:'light',label:'Светлый'}],settings.appearance)+'</div></div>';
    if(currentRole==='seller'||currentRole==='admin'){html+='<div class="section-head"><h2>Приватность продавца</h2></div><div class="card seller-privacy-settings">'+toggleRow('seller_products_public','Общедоступность товаров','Если выключено, товары скрыты от покупателей и обозначаются анонимно.','lock')+'<div class="divider"></div>'+toggleRow('seller_dm_enabled','Доступность личных сообщений','Разрешить покупателям связываться с вами и отправлять списки избранного.','telegram')+'</div>'; }
    html+='<div class="section-head"><h2>Уведомления</h2></div><div class="card notification-settings-card">'+toggleRow('notify_updates','Обновления приложения','Новости, новые возможности и изменения','code')+(currentRole==='buyer'?'':'<div class="divider"></div>'+toggleRow('notify_processed_files','Обработанные файлы','Результат загрузки и ошибки распознавания','file'))+'<div class="divider"></div>'+toggleRow('notify_subscription','Подписка','Напоминания за 72 часа и далее каждые 24 часа','subscription')+'</div>';
    if(desktopSettings)html+='<div class="settings-actions"><button class="button" id="saveSettings">Сохранить настройки</button><button class="button secondary" data-go="notifications">Открыть центр уведомлений '+iconSvg('arrow')+'</button></div>';
    else html+='<button class="button full" id="saveSettings">Сохранить настройки</button><div style="height:12px"></div><button class="button secondary full" data-go="notifications">Открыть центр уведомлений '+iconSvg('arrow')+'</button>';
    if(browserSessionActive && !initData){if(browserMobileMode)html+='<div class="mobile-browser-session-gap" aria-hidden="true"></div>';html+='<section class="card browser-session-card"><div class="card-title">Сеанс браузера</div><p class="tiny muted">Вы вошли через Telegram в этом браузере. Сессия хранится в cookie до 7 дней.</p><button type="button" class="button secondary full browser-logout-button" id="browserLogoutButton">Выйти из аккаунта</button></section>';}
    app.innerHTML=translateHtml(html);bindSettings();return html;});}
  function customDropdown(id,key,options,current){var selected=options.filter(function(o){return o.value===current;})[0]||options[0];return '<div class="custom-select" id="'+id+'" data-selected-value="'+esc(selected.value)+'" data-select-key="'+key+'"><button type="button" class="custom-select-trigger" aria-haspopup="listbox" aria-expanded="false"><span>'+esc(selected.label)+'</span>'+iconSvg('chevron')+'</button><div class="custom-select-menu" role="listbox">'+options.map(function(o){return '<button type="button" role="option" aria-selected="'+(o.value===current?'true':'false')+'" data-value="'+esc(o.value)+'" data-label="'+esc(o.label)+'" class="custom-select-option '+(o.value===current?'selected':'')+'">'+esc(o.label)+(o.value===current?iconSvg('check'):'')+'</button>';}).join('')+'</div></div>'; }
  function themeChoice(key,label,a,b){return '<button class="theme-choice '+(settings.theme===key?'active':'')+'" data-theme="'+key+'"><span class="swatch"><i style="background:'+a+'"></i><i style="background:'+b+'"></i></span>'+label+'</button>';}
  function toggleRow(key,title,sub,symbol){return '<div class="setting-row"><div class="setting-icon">'+iconSvg(symbol)+'</div><div class="setting-copy"><strong>'+title+'</strong><small>'+sub+'</small></div><button class="toggle '+(Number(settings[key])?'on':'')+'" data-toggle="'+key+'" aria-pressed="'+(Number(settings[key])?'true':'false')+'"></button></div>';}
  function bindSettings(){
    document.querySelectorAll('[data-theme]').forEach(function(b){b.onclick=function(){settingsDraftActive=true;settings.theme=b.getAttribute('data-theme');document.querySelectorAll('[data-theme]').forEach(function(x){x.classList.toggle('active',x===b);});applyTheme();};});
    document.querySelectorAll('[data-toggle]').forEach(function(b){b.onclick=function(){settingsDraftActive=true;var k=b.getAttribute('data-toggle');settings[k]=Number(!Number(settings[k]));b.classList.toggle('on',!!settings[k]);b.setAttribute('aria-pressed',settings[k]?'true':'false');applyTheme();};});
    document.querySelectorAll('[data-select-key]').forEach(function(drop){var trigger=drop.querySelector('.custom-select-trigger');trigger.onclick=function(e){e.stopPropagation();var open=drop.classList.contains('open');document.querySelectorAll('[data-select-key]').forEach(function(other){other.classList.remove('open');other.querySelector('.custom-select-trigger').setAttribute('aria-expanded','false');});drop.classList.toggle('open',!open);trigger.setAttribute('aria-expanded',!open?'true':'false');};drop.querySelectorAll('[data-value]').forEach(function(option){option.onclick=function(){var key=drop.getAttribute('data-select-key');var value=option.getAttribute('data-value');settingsDraftActive=true;settings[key]=value;drop.setAttribute('data-selected-value',value);trigger.querySelector('span').textContent=option.getAttribute('data-label');drop.querySelectorAll('[data-value]').forEach(function(other){other.classList.toggle('selected',other===option);other.setAttribute('aria-selected',other===option?'true':'false');var check=other.querySelector('.svg-icon');if(check)check.remove();if(other===option)other.insertAdjacentHTML('beforeend',iconSvg('check'));});drop.classList.remove('open');trigger.setAttribute('aria-expanded','false');applyTheme();if(key==='language'){renderSettings();return;}};});});
    document.getElementById('saveSettings').onclick=function(){api('save_settings',settings).then(function(){savedSettings=Object.assign({},settings);settingsDraftActive=false;cache.settings={time:Date.now(),data:Object.assign({},settings)};toast('Настройки сохранены');applyTheme();renderScreen(activeScreen);}).catch(function(e){toast(e);});};
    var logoutButton=document.getElementById('browserLogoutButton');
    if(logoutButton && browserSessionActive && !initData){logoutButton.onclick=function(){if(logoutButton.disabled)return;logoutButton.disabled=true;logoutButton.textContent='Выходим…';api('browser_logout',{}).then(function(){browserSessionActive=false;window.location.replace(browserMobileMode?'/m/home':'/home');}).catch(function(error){logoutButton.disabled=false;logoutButton.textContent='Выйти из аккаунта';toast(friendlyError(error));});};}
  }
  function renderNotifications(){
    return load('notifications',{},true).then(function(rows){
      var html=heading('ЦЕНТР СОБЫТИЙ','Уведомления','Важное о прайс-листах, подписке и обновлениях.');
      html+='<div class="notifications-content-toolbar" id="notificationsContentToolbar"></div>';
      /* Preserve the shared header action while replacing #app; the Desktop button is temporarily docked back into the shell. */
      var markAllBeforeRender=document.getElementById('markAllReadButton');
      if(markAllBeforeRender&&isDesktopWideShell()){
        var pageMetaActions=document.querySelector('.desktop-page-meta-actions');
        if(pageMetaActions&&markAllBeforeRender.parentNode!==pageMetaActions)pageMetaActions.appendChild(markAllBeforeRender);
      }
      if(!rows.length){
        html+='<div class="empty"><div class="symbol">'+iconSvg('bell')+'</div><strong>Пока тихо</strong><p class="tiny">Новые события появятся здесь.</p></div>';
      }else{
        html+='<div class="card notification-list">';
        rows.forEach(function(n){
          var icon=n.kind==='subscription'?iconSvg('subscription'):((n.kind==='file_processed'||n.kind==='file_upload_accepted')?iconSvg('file'):(n.kind==='update'?iconSvg('megaphone'):iconSvg('bell')));
          var id=String(n.id),open=expandedNotificationId===id;
          html+='<article class="notification-accordion '+(!Number(n.is_read)?'unread ':'')+(open?'open':'')+'" data-notification="'+esc(id)+'"><button class="notification-heading" type="button" aria-expanded="'+(open?'true':'false')+'"><span class="notification-icon">'+icon+'</span><span class="notification-title-wrap"><strong>'+esc(n.title)+'</strong></span><i class="notification-unread-dot" aria-label="Не прочитано"></i><span class="notification-chevron">'+iconSvg('chevron')+'</span></button><div class="notification-details"><div class="notification-details-inner"><p>'+esc(n.body||'')+'</p><time class="notification-detail-time">'+esc(fmtDate(n.created_at))+'</time></div></div></article>';
        });
        html+='</div>';
      }
      app.innerHTML=translateHtml(html);
      var markAll=document.getElementById('markAllReadButton');
      var contentToolbar=document.getElementById('notificationsContentToolbar');
      if(markAll&&isDesktopWideShell()&&contentToolbar)contentToolbar.appendChild(markAll);
      else syncMarkAllReadButtonPlacement();
      function refreshReadAllButton(){
        if(!markAll)return;
        var unreadCount=rows.reduce(function(total,row){return total+(!Number(row.is_read)?1:0);},0);
        var hasUnread=unreadCount>0;
        var label=hasUnread?localizeUiText('Прочитать все ('+unreadCount+')','Mark all as read ('+unreadCount+')','Барлығын оқу ('+unreadCount+')'):localizeUiText('Все прочитано','All read','Бәрі оқылды');
        var svg=markAll.querySelector('svg');
        var iconMarkup=svg?svg.outerHTML:'<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="m2.8 12.5 4.1 4.1 7.3-7.8"/><path d="m9.6 12.5 4.1 4.1 7.3-7.8"/></svg>';
        var desktopWide=!!(document.body&&document.body.classList.contains('desktop-shell')&&isDesktopWideShell());
        markAll.innerHTML=desktopWide?(iconMarkup+'<span class="mark-all-read-label">'+esc(label)+'</span>'):iconMarkup;
        markAll.classList.toggle('mark-all-read-text-button',desktopWide);
        markAll.disabled=!hasUnread;
        markAll.hidden=(activeScreen!=='notifications'||(currentRole==='none'&&!isAdmin));
        markAll.setAttribute('aria-label',label);
        markAll.setAttribute('title',label);
      }
      refreshReadAllButton();
      document.querySelectorAll('[data-notification]').forEach(function(item){
        var button=item.querySelector('.notification-heading');
        button.onclick=function(){
          var id=String(item.getAttribute('data-notification'));
          var wasOpen=item.classList.contains('open');
          document.querySelectorAll('[data-notification]').forEach(function(other){other.classList.remove('open');other.querySelector('.notification-heading').setAttribute('aria-expanded','false');});
          if(!wasOpen){
            item.classList.add('open');button.setAttribute('aria-expanded','true');expandedNotificationId=id;
            var row=rows.filter(function(x){return String(x.id)===id;})[0];
            if(row&&!Number(row.is_read)){
              api('mark_read',{id:Number(id)}).then(function(){
                row.is_read=1;item.classList.remove('unread');
                var dot=item.querySelector('.notification-unread-dot');if(dot)dot.remove();
                delete cache.notifications;delete cache.overview;
                var hasUnread=rows.some(function(x){return !Number(x.is_read);});
                var globalDot=document.getElementById('unreadDot');if(globalDot)globalDot.classList.toggle('on',hasUnread);
                var sideDot=document.getElementById('desktopUnreadDot');if(sideDot)sideDot.classList.toggle('on',hasUnread);
                refreshReadAllButton();
              }).catch(function(e){toast(e);});
            }
          }else{expandedNotificationId=null;}
        };
      });
      return html;
    });
  }
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
      function selectedValuesFromDrop(drop){
        if(!drop)return [];
        if(drop.getAttribute('data-multiple')==='1'){
          try{var parsed=JSON.parse(drop.getAttribute('data-selected-values')||'[]');return Array.isArray(parsed)?parsed.map(String):[];}catch(e){return [];}
        }
        var single=drop.getAttribute('data-selected-value')||'';return single? [single]:[];
      }
      function selectedTypeValues(){var drop=overlay.querySelector('[data-filter-select-key="type"]');if(drop)return selectedValuesFromDrop(drop);var initial=filters.type;if(Array.isArray(initial))return initial.map(String);return initial==null||initial===''?[]:[String(initial)];}
      function selectedTypeInModal(){var values=selectedTypeValues();return values.length?values[0]:'';}
      function currentMeasureOptions(){var selected=selectedTypeValues();var hasDisplay=selected.some(isDisplayType);var hasRegular=selected.some(function(code){return !isDisplayType(code);});if(hasDisplay&&hasRegular)return sizes.concat(volumes);return hasDisplay?sizes:volumes;}
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
      var defectOptions = (opts.defects || []).map(function (code) { return {value:String(code),label:localizedDefect(code)}; });
      var defectFilterItems = [{value:'__none__',label:localizeUiText('Нет','No','Жоқ')}].concat(defectOptions,[{value:'__all_defects__',label:localizeUiText('Все дефекты','All defects','Барлық ақаулар')}]);
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

      function filterDropdown(label, key, items, multiple, noGenericAll) {
        multiple=!!multiple;
        var all=noGenericAll?(items||[]):[{value:'',label:localizedAllLabel()}].concat(items||[]);
        var rawCurrent=filters[key];
        var currentValues=multiple?(Array.isArray(rawCurrent)?rawCurrent.map(String):(rawCurrent==null||rawCurrent===''?[]:[String(rawCurrent)])):[rawCurrent==null?'':String(rawCurrent)];
        if(multiple){
          var allowedMultiValues=(items||[]).map(function(item){return String(item.value==null?'':item.value);}).filter(function(value){return value!=='';});
          currentValues=currentValues.filter(function(value,index){return allowedMultiValues.indexOf(value)!==-1&&currentValues.indexOf(value)===index;});
          if(noGenericAll){
            if(currentValues.indexOf('__none__')!==-1)currentValues=['__none__'];
            else if(currentValues.indexOf('__all_defects__')!==-1)currentValues=['__all_defects__'];
            else if(!currentValues.length)currentValues=['__none__'];
            else if(defectOptions.length&&defectOptions.every(function(item){return currentValues.indexOf(String(item.value))!==-1;}))currentValues=['__all_defects__'];
          }else if(allowedMultiValues.length&&currentValues.length>=allowedMultiValues.length){currentValues=[];}
        }
        var selectedSingle=all.filter(function(item){return String(item.value)===currentValues[0];})[0]||all[0];
        var selectedItems=all.filter(function(item){return String(item.value)!==''&&currentValues.indexOf(String(item.value))!==-1;});
        function summary(){
          if(!multiple)return selectedSingle.label;
          if(!selectedItems.length)return localizedAllLabel();
          if(selectedItems.length===1)return selectedItems[0].label;
          return localizeUiText('Выбрано: '+selectedItems.length,'Selected: '+selectedItems.length,'Таңдалды: '+selectedItems.length);
        }
        var optionHtml=all.map(function(item){
          var value=String(item.value==null?'':item.value);
          var active=multiple?(value===''?!currentValues.length:currentValues.indexOf(value)!==-1):(value===String(selectedSingle.value==null?'':selectedSingle.value));
          return '<button type="button" role="option" aria-selected="'+(active?'true':'false')+'" data-filter-value="'+esc(value)+'" data-filter-label="'+esc(item.label)+'" class="custom-select-option'+(active?' selected':'')+'"><span class="custom-select-option-label-viewport"><span class="custom-select-option-label-text">'+esc(item.label)+'</span></span>'+(active?iconSvg('check'):'')+'</button>';
        }).join('');
        var attrs=multiple?' data-multiple="1" data-selected-values="'+esc(JSON.stringify(currentValues))+'"'+(!noGenericAll?' data-selectable-values="'+esc(JSON.stringify((items||[]).map(function(item){return String(item.value==null?'':item.value);}).filter(Boolean)))+'"':''):' data-selected-value="'+esc(String(selectedSingle.value==null?'':selectedSingle.value))+'"';
        return '<div class="filter-field"><span>'+esc(label)+'</span><div class="custom-select filter-custom-select" data-filter-select-key="'+esc(key)+'"'+attrs+'><button type="button" class="custom-select-trigger" aria-haspopup="listbox" aria-expanded="false"><span>'+esc(summary())+'</span>'+iconSvg('chevron')+'</button><div class="custom-select-menu" role="listbox"'+(multiple?' aria-multiselectable="true"':'')+'>'+optionHtml+'</div></div></div>';
      }
      function priceText(value) {
        return Number(value).toLocaleString(localeTag(), {minimumFractionDigits: 0, maximumFractionDigits: 2}) + ' USD';
      }
      var sortOptions = [
        {value:'price_asc', label:'Сначала дешевле'},
        {value:'price_desc', label:'Сначала дороже'},
        {value:'name', label:'А–Я'},
        {value:'name_desc', label:'Я–А'},
        {value:'volume', label:localizedMeasureLabel((Array.isArray(filters.type)?filters.type:[filters.type]).some(isDisplayType))},
        {value:'newest', label:'Сначала новые'},
        {value:'oldest', label:'Сначала старые'}
      ];
      function sortMarkup() {
        return sortOptions.map(function(item) {
          var active = item.value === selectedSort;
          return '<button type="button" class="sort-option' + (active ? ' active' : '') + '" data-sort-value="' + item.value + '" aria-pressed="' + (active ? 'true' : 'false') + '"><span>' + esc(item.label) + '</span>' + (active ? iconSvg('check') : '') + '</button>';
        }).join('');
      }
      function sellerCountLabel(count){
        var n=Number(count)||0;
        return settings.language==='en'?'(products: '+n+')':(settings.language==='kz'?'(тауар саны: '+n+')':'(товаров: '+n+')');
      }
      var sellerFilterMarkup = '';
      if (sellerFilterEnabled) {
        var sellerItems = opts.sellers || [];
        var selectableSellerIds=sellerItems.filter(function(seller){return !(!!Number(seller.is_private)&&!isAdmin);}).map(function(seller){return Number(seller.tg_id);}).filter(function(id){return id>0;});
        selectedSellerIds=selectedSellerIds.filter(function(id){return selectableSellerIds.indexOf(id)!==-1;});
        if(selectableSellerIds.length&&selectableSellerIds.every(function(id){return selectedSellerIds.indexOf(id)!==-1;}))selectedSellerIds=[];
        var sellerRows = sellerItems.map(function(seller){
          var privateRow=!!Number(seller.is_private)&&!isAdmin;
          var label=seller.full_name||'Продавец';
          if(privateRow){return '<div role="option" aria-disabled="true" class="custom-select-option seller-filter-option seller-filter-private" tabindex="-1"><span class="seller-filter-lock">'+iconSvg('lock')+'</span><span class="seller-filter-copy"><span class="seller-filter-name">'+esc(label)+'</span><small class="seller-product-count seller-product-count-hidden">'+localizeUiText('Товары скрыты','Products hidden','Тауарлар жасырылған')+'</small></span></div>';}
          var id=Number(seller.tg_id),checked=selectedSellerIds.indexOf(id)!==-1;
          var countVisible=Number(seller.is_public)===1&&seller.product_count!=null;
          var count=countVisible?'<small class="seller-product-count">'+esc(sellerCountLabel(seller.product_count))+'</small>':'';
          return '<button type="button" role="option" class="custom-select-option seller-filter-option '+(checked?'selected':'')+'" data-seller-filter-id="'+id+'" aria-selected="'+(checked?'true':'false')+'" aria-pressed="'+(checked?'true':'false')+'"><span class="seller-filter-copy"><span class="seller-filter-name">'+esc(label)+'</span>'+count+'</span>'+(checked?iconSvg('check'):'')+'</button>';
        }).join('');
        var sellerSummary = selectedSellerIds.length===0 ? 'Все продавцы' : (selectedSellerIds.length===1 ? (function(){var found=sellerItems.filter(function(s){return Number(s.tg_id)===selectedSellerIds[0];})[0];return found?(found.full_name||'Продавец'):'Выбран 1 продавец';})() : 'Выбрано продавцов: '+selectedSellerIds.length);
        var sellerAllOption = '<button type="button" role="option" class="custom-select-option seller-filter-option seller-filter-all '+(selectedSellerIds.length?'':'selected')+'" data-seller-filter-all aria-selected="'+(selectedSellerIds.length?'false':'true')+'" aria-pressed="'+(selectedSellerIds.length?'false':'true')+'"><span class="seller-filter-copy"><span class="seller-filter-name">'+localizeUiText('Все продавцы','All sellers','Барлық сатушылар')+'</span></span>'+(selectedSellerIds.length?'':iconSvg('check'))+'</button>';
        sellerFilterMarkup='<div class="filter-field seller-filter-block"><span>Продавцы</span><div class="custom-select filter-custom-select seller-custom-select" data-seller-select><button type="button" class="custom-select-trigger" aria-haspopup="listbox" aria-expanded="false"><span data-seller-filter-summary>'+esc(sellerSummary)+'</span>'+iconSvg('chevron')+'</button><div class="custom-select-menu seller-filter-menu" role="listbox" aria-label="Выбор продавцов">'+sellerAllOption+(sellerRows||'<div class="tiny muted seller-filter-empty">Продавцы пока не найдены.</div>')+'</div></div></div>';
      }

      overlay.innerHTML = '<div class="filter-modal" role="dialog" aria-modal="true" aria-labelledby="filterTitle"><div class="modal-grab" aria-label="Потяните вниз, чтобы закрыть"><span></span></div><div class="modal-content"><div class="modal-head"><div><div class="eyebrow">ТОЧНЫЙ ПОИСК</div><h2 id="filterTitle">Фильтры каталога</h2><p class="tiny muted">Комбинируй условия — результаты обновятся после применения.</p></div></div>' +
        '<div class="filter-tabs" data-active-tab="filters" role="tablist" aria-label="Разделы фильтров"><button type="button" class="filter-tab active" data-filter-tab="filters" role="tab" aria-selected="true">Фильтры</button><button type="button" class="filter-tab" data-filter-tab="sort" role="tab" aria-selected="false">Порядок вывода</button></div>' +
        '<section class="filter-tab-panel" data-filter-panel="filters"><div class="filter-grid">' +
        filterDropdown('Бренд', 'brand', brands, true) +
        filterDropdown('Тип / концентрация', 'type', types, true) +
        filterDropdown(localizedMeasureLabel((Array.isArray(filters.type)?filters.type:[filters.type]).some(isDisplayType)), 'volume', currentMeasureOptions(), true) +
        (buyerFilters ? '' : filterDropdown('Прайс-лист', 'file_id', files, true)) +
        filterDropdown('Пол', 'gender', genders, true) +
        filterDropdown('Категория', 'category', categories, true) +
        filterDropdown('Тестер', 'tester', [{ value: '0', label: (settings.language==='en'?'No, regular product':(settings.language==='kz'?'Жоқ, кәдімгі тауар':'Нет, обычный товар')) }, { value: '1', label: (settings.language==='en'?'Yes, tester':(settings.language==='kz'?'Иә, тестер':'Да, тестер')) }]) +
        filterDropdown('Набор', 'is_set', [{ value: '0', label: localizeUiText('Одиночный товар','Single item','Жеке тауар') }, { value: '1', label: localizeUiText('Набор / комплект','Set / kit','Жиынтық') }]) +
        (buyerFilters ? '' : filterDropdown('Проверка парсинга', 'needs_review', [{ value: '0', label: 'Без проверки' }, { value: '1', label: 'Требует проверки' }])) +
        sellerFilterMarkup +
        filterDropdown('Дефекты', 'defects', defectFilterItems, true, true) +
        '</div><div class="price-filter-block"><div class="price-filter-title">Интервал цен</div><div class="price-mode-toggle" data-active-mode="slider" role="group" aria-label="Способ выбора цены"><button type="button" data-price-mode="slider" class="active" aria-pressed="true">Ползунок</button><button type="button" data-price-mode="keyboard" aria-pressed="false">Клавиатура</button></div>' +
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

      function refreshOptionMarquees(container){
        if(!container||!document.body.classList.contains('desktop-shell'))return;
        window.requestAnimationFrame(function(){
          container.querySelectorAll('.custom-select-option-label-viewport').forEach(function(viewport){
            var text=viewport.querySelector('.custom-select-option-label-text');
            var option=viewport.closest('.custom-select-option');
            if(!text||!option)return;
            option.classList.remove('has-marquee');
            option.style.removeProperty('--marquee-distance');
            option.style.removeProperty('--marquee-duration');
            var distance=Math.ceil(text.scrollWidth-viewport.clientWidth+viewport.clientWidth*0.18+10);
            if(distance>10){
              option.style.setProperty('--marquee-distance',distance+'px');
              option.style.setProperty('--marquee-duration',Math.max(5,Math.min(16,4+distance/24))+'s');
              option.classList.add('has-marquee');
            }
          });
        });
      }
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

      function paintFilterDrop(drop){
        var multiple=drop.getAttribute('data-multiple')==='1';
        var values=selectedValuesFromDrop(drop);
        var options=drop.querySelectorAll('[data-filter-value]');
        options.forEach(function(option){
          var value=option.getAttribute('data-filter-value')||'';
          var selected=multiple?(value===''?!values.length:values.indexOf(value)!==-1):(value===(drop.getAttribute('data-selected-value')||''));
          option.classList.toggle('selected',selected);option.setAttribute('aria-selected',selected?'true':'false');
          var check=option.querySelector('.svg-icon');if(check)check.remove();if(selected)option.insertAdjacentHTML('beforeend',iconSvg('check'));
        });
        var trigger=drop.querySelector('.custom-select-trigger span');if(!trigger)return;
        if(!multiple){var value=drop.getAttribute('data-selected-value')||'';var option=Array.prototype.find.call(options,function(item){return (item.getAttribute('data-filter-value')||'')===value;});trigger.textContent=option?(option.getAttribute('data-filter-label')||localizedAllLabel()):localizedAllLabel();return;}
        var selectedItems=Array.prototype.filter.call(options,function(item){var v=item.getAttribute('data-filter-value')||'';return v!==''&&values.indexOf(v)!==-1;});
        if(!selectedItems.length)trigger.textContent=localizedAllLabel();
        else if(selectedItems.length===1)trigger.textContent=selectedItems[0].getAttribute('data-filter-label')||localizedAllLabel();
        else trigger.textContent=localizeUiText('Выбрано: '+selectedItems.length,'Selected: '+selectedItems.length,'Таңдалды: '+selectedItems.length);
      }
      function bindFilterDropdown(drop) {
        var trigger = drop.querySelector('.custom-select-trigger');
        if (!drop.getAttribute('data-handler-bound')) {
          trigger.onclick = function (event) {
            event.stopPropagation();var willOpen=!drop.classList.contains('open');closeDrops(drop);drop.classList.toggle('open',willOpen);trigger.setAttribute('aria-expanded',willOpen?'true':'false');if(willOpen)refreshOptionMarquees(drop.querySelector('.custom-select-menu'));
          };
          drop.setAttribute('data-handler-bound','1');
        }
        drop.querySelectorAll('[data-filter-value]').forEach(function (option) {
          if (option.getAttribute('data-handler-bound') === '1') return;
          option.setAttribute('data-handler-bound','1');
          option.onclick = function (event) {
            event.stopPropagation();var value=option.getAttribute('data-filter-value')||'';
            if(drop.getAttribute('data-multiple')==='1'){
              var values=selectedValuesFromDrop(drop);
              if(value===''){values=[];}else if(drop.getAttribute('data-filter-select-key')==='defects'){
                var allDefectValues=defectOptions.map(function(item){return String(item.value);});
                if(value==='__none__'||value==='__all_defects__'){
                  values=values.indexOf(value)!==-1?['__none__']:[value];
                }else{
                  if(values.indexOf('__all_defects__')!==-1){
                    values=allDefectValues.filter(function(item){return item!==value;});
                  }else{
                    values=values.filter(function(item){return item!=='__none__'&&item!=='__all_defects__';});
                    var defectIndex=values.indexOf(value);
                    if(defectIndex===-1)values.push(value);else values.splice(defectIndex,1);
                  }
                  if(!values.length)values=['__none__'];
                  else if(allDefectValues.length&&allDefectValues.every(function(item){return values.indexOf(item)!==-1;}))values=['__all_defects__'];
                }
              }else{
                var index=values.indexOf(value);if(index===-1)values.push(value);else values.splice(index,1);
                var allValues=JSON.parse(drop.getAttribute('data-selectable-values')||'[]').map(String);
                if(allValues.length&&allValues.every(function(item){return values.indexOf(item)!==-1;}))values=[];
              }
              drop.setAttribute('data-selected-values',JSON.stringify(values));paintFilterDrop(drop);
              // Keep multi-select menus open so users can choose several values without reopening them.
              if(drop.getAttribute('data-filter-select-key')==='type')refreshMeasureDropdown();
              return;
            }
            var label=option.getAttribute('data-filter-label')||localizedAllLabel();drop.setAttribute('data-selected-value',value);paintFilterDrop(drop);
            drop.classList.remove('open');trigger.setAttribute('aria-expanded','false');
            if(drop.getAttribute('data-filter-select-key')==='type')refreshMeasureDropdown();
          };
        });
      }
      function refreshMeasureDropdown(){
        var drop=overlay.querySelector('[data-filter-select-key="volume"]');if(!drop)return;
        var options=currentMeasureOptions();var current=selectedValuesFromDrop(drop);var allowed=options.map(function(item){return String(item.value);});
        current=current.filter(function(value){return allowed.indexOf(value)!==-1;});if(allowed.length&&allowed.every(function(value){return current.indexOf(value)!==-1;}))current=[];drop.setAttribute('data-selected-values',JSON.stringify(current));drop.setAttribute('data-selectable-values',JSON.stringify(allowed));
        var field=drop.parentNode;var fieldTitle=field.querySelector(':scope > span');if(fieldTitle)fieldTitle.textContent=localizedMeasureLabel(selectedTypeValues().some(isDisplayType));
        var all=[{value:'',label:localizedAllLabel()}].concat(options);var menu=drop.querySelector('.custom-select-menu');
        menu.innerHTML=all.map(function(item){var value=String(item.value==null?'':item.value);var active=value===''?!current.length:current.indexOf(value)!==-1;return '<button type="button" role="option" aria-selected="'+(active?'true':'false')+'" data-filter-value="'+esc(value)+'" data-filter-label="'+esc(item.label)+'" class="custom-select-option'+(active?' selected':'')+'"><span class="custom-select-option-label-viewport"><span class="custom-select-option-label-text">'+esc(item.label)+'</span></span>'+(active?iconSvg('check'):'')+'</button>';}).join('');
        var sortLabel=overlay.querySelector('[data-sort-value="volume"] span');if(sortLabel)sortLabel.textContent=localizedMeasureLabel(selectedTypeValues().some(isDisplayType));
        bindFilterDropdown(drop);paintFilterDrop(drop);
      }
      overlay.querySelectorAll('[data-filter-select-key]').forEach(bindFilterDropdown);
      function paintSellerFilters(){
        function paintOption(button,checked){
          button.classList.toggle('selected',checked);
          button.setAttribute('aria-pressed',checked?'true':'false');
          button.setAttribute('aria-selected',checked?'true':'false');
          var check=button.querySelector('.svg-icon');
          if(check)check.remove();
          if(checked)button.insertAdjacentHTML('beforeend',iconSvg('check'));
        }
        overlay.querySelectorAll('[data-seller-filter-id]').forEach(function(button){
          paintOption(button,selectedSellerIds.indexOf(Number(button.getAttribute('data-seller-filter-id')))!==-1);
        });
        var all=overlay.querySelector('[data-seller-filter-all]');
        if(all)paintOption(all,selectedSellerIds.length===0);
        var summary=overlay.querySelector('[data-seller-filter-summary]');
        if(summary){
          if(!selectedSellerIds.length)summary.textContent=localizeUiText('Все продавцы','All sellers','Барлық сатушылар');
          else if(selectedSellerIds.length===1){var chosen=(opts.sellers||[]).filter(function(s){return Number(s.tg_id)===selectedSellerIds[0];})[0];summary.textContent=chosen?(chosen.full_name||'Продавец'):localizeUiText('Выбран 1 продавец','1 seller selected','1 сатушы таңдалды');}
          else summary.textContent=localizeUiText('Выбрано продавцов: '+selectedSellerIds.length,'Sellers selected: '+selectedSellerIds.length,'Таңдалған сатушылар: '+selectedSellerIds.length);
        }
      }
      var sellerDrop=overlay.querySelector('[data-seller-select]');if(sellerDrop){var sellerTrigger=sellerDrop.querySelector('.custom-select-trigger');sellerTrigger.onclick=function(event){event.stopPropagation();var willOpen=!sellerDrop.classList.contains('open');closeDrops(sellerDrop);sellerDrop.classList.toggle('open',willOpen);sellerTrigger.setAttribute('aria-expanded',willOpen?'true':'false');};}
      overlay.querySelectorAll('[data-seller-filter-id]').forEach(function(button){button.onclick=function(event){event.stopPropagation();var id=Number(button.getAttribute('data-seller-filter-id'));var at=selectedSellerIds.indexOf(id);if(at===-1)selectedSellerIds.push(id);else selectedSellerIds.splice(at,1);if(selectableSellerIds.length&&selectableSellerIds.every(function(sellerId){return selectedSellerIds.indexOf(sellerId)!==-1;}))selectedSellerIds=[];paintSellerFilters();};});
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
          if(drop.getAttribute('data-multiple')==='1'){
            var initial=drop.getAttribute('data-filter-select-key')==='defects'?['__none__']:[];
            drop.setAttribute('data-selected-values',JSON.stringify(initial));
          }else drop.setAttribute('data-selected-value','');
          paintFilterDrop(drop);
        });
        minKeyboard.value = ''; maxKeyboard.value = '';
        selectedSellerIds=[];paintSellerFilters(); refreshMeasureDropdown();
        sliderMin.value = domainMin; sliderMax.value = domainMax;
        updatePriceUi(); setPriceMode('slider'); setSort('price_asc');
      };
      overlay.querySelector('[data-filter-apply]').onclick = function () {
        var next = {};
        overlay.querySelectorAll('[data-filter-select-key]').forEach(function (drop) {
          var key=drop.getAttribute('data-filter-select-key');
          if(drop.getAttribute('data-multiple')==='1')next[key]=selectedValuesFromDrop(drop);
          else next[key]=drop.getAttribute('data-selected-value')||'';
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
    return map[code]||(value?String(value):localizeUiText('тип не указан','type not specified','түрі көрсетілмеген'));
  }
  function productMeasureLabel(p){var display=isDisplayProduct(p);return settings.language==='en'?(display?'Size':'Volume'):(settings.language==='kz'?(display?'Өлшем':'Көлем'):(display?'Размер':'Объём'));}
  function localizedDefect(code){
    var raw=String(code||'').trim();if(!raw)return '';
    var key=raw.toLowerCase().replace(/[\s-]+/g,'_');
    var dictionary={
      bottle_damaged:['Повреждён флакон','Damaged bottle','Құты зақымдалған'],damaged_bottle:['Повреждён флакон','Damaged bottle','Құты зақымдалған'],damaged_box:['Повреждена коробка','Damaged box','Қорап зақымдалған'],box_damaged:['Повреждена коробка','Damaged box','Қорап зақымдалған'],
      missing_cap:['Нет крышки','Missing cap','Қақпақ жоқ'],no_cap:['Нет крышки','Missing cap','Қақпақ жоқ'],without_cap:['Нет крышки','Missing cap','Қақпақ жоқ'],
      damaged_cap:['Повреждена крышка','Damaged cap','Қақпақ зақымдалған'],
      no_cellophane:['Нет целлофана','No cellophane','Целлофан жоқ'],without_cellophane:['Нет целлофана','No cellophane','Целлофан жоқ'],
      broken_sprayer:['Неисправный распылитель','Faulty sprayer','Бүріккіш ақаулы'],sprayer_damaged:['Неисправный распылитель','Faulty sprayer','Бүріккіш ақаулы'],
      leak:['Протекает','Leaking','Ағады'],leaking:['Протекает','Leaking','Ағады'],
      scratches:['Царапины','Scratches','Сызаттар'],scratched:['Царапины','Scratches','Сызаттар'],
      damaged_packaging:['Повреждена упаковка','Damaged packaging','Қаптама зақымдалған'],
      no_original_box:['Нет оригинальной коробки','No original box','Түпнұсқа қорап жоқ']
    };
    if(dictionary[key])return localizeUiText(dictionary[key][0],dictionary[key][1],dictionary[key][2]);
    /* Recognize common parser aliases and future variants without exposing raw enum codes. */
    var patternLabels=[
      [/box.*(damage|broken|crack)|(damage|broken|crack).*box/i,['Повреждена коробка','Damaged box','Қорап зақымдалған']],
      [/(cap|lid).*(missing|none|without|no)|(missing|none|without|no).*(cap|lid)/i,['Нет крышки','Missing cap','Қақпақ жоқ']],
      [/(cellophane|shrink|film|wrap).*(missing|none|without|no)|(missing|none|without|no).*(cellophane|shrink|film|wrap)/i,['Нет целлофана','No cellophane','Целлофан жоқ']],
      [/(spray|sprayer|atomizer|pump).*(broken|damage|fault)|(broken|damage|fault).*(spray|sprayer|atomizer|pump)/i,['Неисправный распылитель','Faulty sprayer','Бүріккіш ақаулы']],
      [/leak|leaking/i,['Протекает','Leaking','Ағады']],
      [/scratch|scratched/i,['Царапины','Scratches','Сызаттар']],
      [/packag.*(damage|broken)|(damage|broken).*packag/i,['Повреждена упаковка','Damaged packaging','Қаптама зақымдалған']],
      [/(original_)?box.*(missing|none|without|no)|(missing|none|without|no).*(original_)?box/i,['Нет оригинальной коробки','No original box','Түпнұсқа қорап жоқ']]
    ];
    for(var patternIndex=0;patternIndex<patternLabels.length;patternIndex++){if(patternLabels[patternIndex][0].test(key))return localizeUiText(patternLabels[patternIndex][1][0],patternLabels[patternIndex][1][1],patternLabels[patternIndex][1][2]);}
    var readable=raw.replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
    readable=readable.charAt(0).toUpperCase()+readable.slice(1);
    return localizeUiText('Дефект: '+readable,'Defect: '+readable,'Ақау: '+readable);
  }
  function productCardMarkup(p, isBuyer) {
    var publicFallback=Number(p.public_catalog_fallback)===1;var buyerPriceView=!!isBuyer||publicFallback;
    var parts=[localizedProductType(p.type),productMeasureText(p)];
    if(!buyerPriceView&&p.filename)parts.push(p.filename);
    var finalPrice=Number(buyerPriceView?p.price_usd:(p.base_price!==undefined?p.base_price:p.price_usd));
    var multiplier=Number(p.price_multiplier||1);
    var effectivePrice=p.effective_price!==undefined?Number(p.effective_price):finalPrice*multiplier;
    var boosted=!buyerPriceView?'<div class="product-price-boost '+(effectivePrice<finalPrice?'is-lower':'')+'">(x'+esc(multiplier.toLocaleString(localeTag(),{minimumFractionDigits:2,maximumFractionDigits:2}))+') '+esc(fmtMoney(effectivePrice,p.currency))+'</div>':'';
    var canFavorite=isBuyer||currentRole==='seller'||currentRole==='admin'||isAdmin;
    var favorite=canFavorite?'<button type="button" class="favorite-toggle '+(Number(p.is_favorite)?'active':'')+'" data-favorite-id="'+Number(p.id)+'" data-favorite-active="'+(Number(p.is_favorite)?'1':'0')+'" aria-pressed="'+(Number(p.is_favorite)?'true':'false')+'" aria-label="'+(Number(p.is_favorite)?localizeUiText('Убрать из избранного','Remove from favourites','Таңдаулылардан алып тастау'):localizeUiText('Добавить в избранное','Add to favourites','Таңдаулыларға қосу'))+'" title="'+(Number(p.is_favorite)?localizeUiText('Убрать из избранного','Remove from favourites','Таңдаулылардан алып тастау'):localizeUiText('Добавить в избранное','Add to favourites','Таңдаулыларға қосу'))+'">'+favoriteStarSvg(!!Number(p.is_favorite))+'</button>':'';
    var defectTags=(Array.isArray(p.defects)?p.defects:[]).map(function(code){return '<span class="tag defect-tag">'+esc(localizedDefect(code))+'</span>';}).join('');
    return '<article class="product-card '+(buyerPriceView?'buyer-product-card':'')+' '+(canFavorite?'product-card-has-favorite':'')+'" data-open-product="'+Number(p.id)+'" tabindex="0" role="button" aria-label="Подробнее о товаре"><div class="product-card-info"><div class="product-heading-line"><div class="product-name">'+esc(p.brand?p.brand+' — ':'')+esc(p.name)+'</div></div><div class="product-sub">'+esc(parts.join(' · '))+'</div></div><div class="product-price-wrap"><div class="product-price">'+esc(fmtMoney(finalPrice,p.currency))+'</div>'+boosted+(canFavorite?'<div class="product-favorite-under-price">'+favorite+'</div>':'')+'</div><div class="product-tag">'+(p.is_tester?'<span class="tag">'+localizeUiText('Тестер','Tester','Тестер')+'</span>':'')+(p.is_set?'<span class="tag">'+localizeUiText('Набор','Set','Жиынтық')+'</span>':'')+defectTags+((currentRole!=='buyer'&&p.needs_review)?'<span class="tag">'+localizeUiText('Нужна проверка','Needs review','Тексеру қажет')+'</span>':'')+'</div></article>';
  }
  function bindProductCards(root){
    if(!root)return;root.querySelectorAll('[data-open-product]').forEach(function(card){if(card.dataset.productBound==='1')return;card.dataset.productBound='1';card.addEventListener('click',function(e){if(e.target.closest('button,a,input,select,textarea'))return;openProductModal(Number(card.getAttribute('data-open-product')));});card.addEventListener('keydown',function(e){if((e.key==='Enter'||e.key===' ')&&e.target===card){e.preventDefault();openProductModal(Number(card.getAttribute('data-open-product')));}});});
  }
  function openProductModal(productId){
    if(!Number.isInteger(Number(productId))||Number(productId)<1)return;
    var old=document.getElementById('productDetailOverlay');if(old)old.remove();
    var overlay=document.createElement('div');overlay.id='productDetailOverlay';overlay.className='modal-backdrop product-detail-backdrop';
    overlay.innerHTML='<section class="filter-modal modal-filter product-detail-modal" role="dialog" aria-modal="true" aria-labelledby="productDetailTitle"><div class="modal-grab" aria-label="'+localizeUiText('Потяните вниз, чтобы закрыть','Drag down to close','Жабу үшін төмен тартыңыз')+'"><span></span></div><div class="modal-content product-detail-content"><div class="loading-card"><div class="spinner"></div>'+localizeUiText('Загружаем товар…','Loading product…','Тауар жүктелуде…')+'</div></div></section>';
    document.body.appendChild(overlay);var popup=overlay.querySelector('.product-detail-modal');bindSheetDrag(overlay,popup);
    function close(){if(!overlay.isConnected)return;overlay.classList.add('closing');document.removeEventListener('keydown',onKey);setTimeout(function(){if(overlay.isConnected)overlay.remove();},240);}
    function onKey(e){if(e.key==='Escape')close();}document.addEventListener('keydown',onKey);overlay.addEventListener('click',function(e){if(e.target===overlay)close();});setTimeout(function(){if(overlay.isConnected)overlay.classList.add('is-open');},10);
    api('product_details',{product_id:Number(productId)}).then(function(p){if(!overlay.isConnected)return;
      var isBuyer=currentRole==='buyer',publicFallback=Number(p.public_catalog_fallback)===1,buyerPriceView=isBuyer||publicFallback,canFavorite=!!p.can_favorite,base=Number(p.base_price||0),boost=Number(p.effective_price||base*Number(p.price_multiplier||1)),currency=p.currency||'USD';
      var sellerName=p.seller_name|| (p.seller_username?'@'+p.seller_username:localizeUiText('Продавец','Seller','Сатушы')+' · ID '+p.seller_tg_id);
      var details='';
      function detailLabel(label){var labels={'Название':['Name','Атауы'],'Бренд':['Brand','Бренд'],'Тип':['Type','Түрі'],'Категория':['Category','Санат'],'Пол':['Gender','Жынысы'],'Тестер':['Tester','Тестер'],'Дефекты':['Defects','Ақаулар'],'Содержимое набора':['Set contents','Жиынтық құрамы'],'Цена':['Price','Бағасы'],'Цена с множителем':['Price with multiplier','Көбейткіші бар баға'],'Прайс-лист':['Price list','Прайс-парақ'],'Точность':['Confidence','Дәлдік'],'Продавец':['Seller','Сатушы']};var item=labels[label];return item?localizeUiText(label,item[0],item[1]):label;}
      function detailCategory(value){var key=String(value||'').toLowerCase();var labels={body:['Для тела','Body','Дене'],hair:['Для волос','Hair','Шаш'],makeup:['Макияж','Makeup','Макияж'],other:['Другое','Other','Басқа'],perfume:['Парфюмерия','Perfume','Парфюмерия'],cosmetics:['Косметика','Cosmetics','Косметика']};var entry=labels[key];return entry?localizeUiText(entry[0],entry[1],entry[2]):value;}
      function field(label,value,wide){return '<div class="product-detail-field'+(wide?' product-detail-field-wide':'')+'"><span>'+esc(detailLabel(label))+'</span><strong>'+esc(value==null||value===''?'—':String(value))+'</strong></div>';}
      function setContentsField(components){
        var rows=(components||[]).map(function(component){var title=[component.brand,component.name].filter(Boolean).join(' — ')||localizeUiText('Товар без названия','Unnamed item','Атаусыз тауар');var meta=[];if(component.quantity&&Number(component.quantity)>1)meta.push('×'+Number(component.quantity));if(component.volume_text)meta.push(component.volume_text);else if(component.volume_ml)meta.push(Number(component.volume_ml)+(settings.language==='en'?' ml':' мл'));if(component.type)meta.push(localizedProductType(component.type));if(component.gender)meta.push(component.gender==='M'?localizeUiText('Мужской','Male','Ер'):(component.gender==='F'?localizeUiText('Женский','Female','Әйел'):localizeUiText('Унисекс','Unisex','Унисекс')));return '<div class="product-detail-set-item"><strong>'+esc(title)+'</strong>'+(meta.length?'<span>'+esc(meta.join(' · '))+'</span>':'')+'</div>';}).join('');
        if(!rows)rows='<div class="tiny muted">'+localizeUiText('Состав набора не указан','Set contents are not specified','Жиынтық құрамы көрсетілмеген')+'</div>';
        return '<div class="product-detail-field product-detail-field-wide product-detail-set-contents"><span>'+esc(detailLabel('Содержимое набора'))+'</span><div class="product-detail-set-list">'+rows+'</div></div>';
      }
      details+=field('Бренд',p.brand);
      details+=field('Название',p.name);
      if(!Number(p.is_set))details+=field(productMeasureLabel(p),productMeasureText(p));
      details+=field('Тип',localizedProductType(p.type));
      details+=field('Категория',detailCategory(p.category));
      details+=field('Пол',p.gender==='M'?localizeUiText('Мужской','Male','Ер'): (p.gender==='F'?localizeUiText('Женский','Female','Әйел'):(p.gender?localizeUiText('Унисекс','Unisex','Унисекс'):'—')),!!Number(p.is_set));
      if(Number(p.is_set))details+=setContentsField(p.set_components||[]);
      else details+=field('Тестер',Number(p.is_tester)?localizeUiText('Да','Yes','Иә'):localizeUiText('Нет','No','Жоқ'));
      var defects=Array.isArray(p.defects)?p.defects:[];details+=field('Дефекты',defects.length?defects.map(localizedDefect).join(', '):'—');
      details+=field('Цена',fmtMoney(buyerPriceView?boost:base,currency));
      if(!buyerPriceView)details+=field('Цена с множителем',fmtMoney(boost,currency));
      if(!publicFallback&&(currentRole==='seller'||currentRole==='admin'||isAdmin))details+=field('Прайс-лист',p.filename||'—');
      if(!buyerPriceView&&(currentRole==='admin'||isAdmin)){
        var confidence=p.parse_confidence==null?null:Number(p.parse_confidence);
        var confidenceText=confidence===null||!Number.isFinite(confidence)?'—':(Math.round((confidence<=1?confidence*100:confidence)*10)/10)+'%';
        details+=field('Точность',confidenceText);
      }
      details+=field('Продавец',sellerName);
      var sellerDraft=localizeUiText('Здравствуйте! Интересует товар: ','Hello! I am interested in: ','Сәлеметсіз бе! Мына тауар қызықтырады: ')+[p.brand,p.name,productMeasureText(p),localizedProductType(p.type)].filter(Boolean).join(' · ')+'.';
      var sellerHref=p.seller_username?'https://t.me/'+encodeURIComponent(String(p.seller_username).replace(/^@/,''))+'?text='+encodeURIComponent(sellerDraft):(p.seller_tg_id?'tg://user?id='+encodeURIComponent(String(p.seller_tg_id)):'' );
      var html='<div class="product-detail-eyebrow">'+localizeUiText('КАТАЛОГ BASALT','BASALT CATALOG','BASALT КАТАЛОГЫ')+'</div><h2 id="productDetailTitle">'+esc(p.brand?p.brand+' — '+p.name:p.name)+'</h2><div class="product-detail-fields">'+details+'</div><div class="product-detail-actions">';
      if(canFavorite)html+='<button type="button" class="button full product-detail-favorite" data-detail-favorite="'+Number(p.id)+'" data-favorite-active="'+(Number(p.is_favorite)?'1':'0')+'">'+favoriteStarSvg(!!Number(p.is_favorite))+'<span>'+(Number(p.is_favorite)?localizeUiText('Убрать из избранного','Remove from favourites','Таңдаулылардан алып тастау'):localizeUiText('Добавить в избранное','Add to favourites','Таңдаулыларға қосу'))+'</span></button>';
      if(!Number(p.public_catalog_fallback)&&(currentRole==='seller'||currentRole==='admin'||isAdmin)&&p.file_id&&String(p.file_status)==='ready')html+='<button type="button" class="button secondary full" data-detail-download="'+Number(p.file_id)+'">'+localizeUiText('Скачать прайс-лист','Download price list','Прайс-парақты жүктеу')+' '+iconSvg('arrow')+'</button>';
      if((isBuyer||isAdmin||currentRole==='admin')&&sellerHref&&(isAdmin||Number(p.seller_dm_available)===1))html+='<a class="button secondary full telegram-link" href="'+esc(sellerHref)+'" '+(p.seller_username?'target="_blank" rel="noopener noreferrer"':'')+'>'+localizeUiText('Связаться с продавцом','Contact seller','Сатушымен байланысу')+' '+iconSvg('arrow')+'</a>';else if((isBuyer||isAdmin||currentRole==='admin')&&!isAdmin)html+='<button class="button secondary full contact-seller-disabled" type="button" disabled aria-disabled="true" title="'+localizeUiText('Продавец отключил личные сообщения','The seller disabled direct messages','Сатушы жеке хабарламаларды өшірді')+'">'+localizeUiText('Связаться с продавцом','Contact seller','Сатушымен байланысу')+' '+iconSvg('arrow')+'</button>';
      html+='</div>';
      popup.querySelector('.product-detail-content').innerHTML=html;
      var detailFields=popup.querySelector('.product-detail-fields');
      function sizeOrphanDetailField(){if(!detailFields||!detailFields.isConnected)return;detailFields.querySelectorAll('.product-detail-field-auto-wide').forEach(function(el){el.classList.remove('product-detail-field-auto-wide');});var children=Array.prototype.slice.call(detailFields.children);if(children.length<2)return;var columns=getComputedStyle(detailFields).gridTemplateColumns.split(/\s+/).filter(Boolean).length;if(columns<2)return;var last=children[children.length-1],previous=children[children.length-2];if(last.classList.contains('product-detail-field-wide'))return;if(last.getBoundingClientRect().top>previous.getBoundingClientRect().top+3)last.classList.add('product-detail-field-auto-wide');}
      requestAnimationFrame(sizeOrphanDetailField);window.addEventListener('resize',sizeOrphanDetailField);
      var originalClose=close;close=function(){window.removeEventListener('resize',sizeOrphanDetailField);originalClose();};
      var fav=popup.querySelector('[data-detail-favorite]');if(fav)fav.onclick=function(){fav.disabled=true;api('favorite_toggle',{product_id:Number(productId),favorite:fav.getAttribute('data-favorite-active')!=='1'}).then(function(r){fav.setAttribute('data-favorite-active',r.is_favorite?'1':'0');fav.innerHTML=favoriteStarSvg(!!r.is_favorite)+'<span>'+(r.is_favorite?localizeUiText('Убрать из избранного','Remove from favourites','Таңдаулылардан алып тастау'):localizeUiText('Добавить в избранное','Add to favourites','Таңдаулыларға қосу'))+'</span>';updateFavoritesCount(r.favorites_count);document.querySelectorAll('[data-favorite-id="'+Number(productId)+'"]').forEach(function(b){b.setAttribute('data-favorite-active',r.is_favorite?'1':'0');b.classList.toggle('active',!!r.is_favorite);b.setAttribute('aria-pressed',r.is_favorite?'true':'false');b.innerHTML=favoriteStarSvg(!!r.is_favorite);});fav.disabled=false;delete cache.favorites;var favoritesOverlay=document.getElementById('favoritesOverlay');if(favoritesOverlay)favoritesOverlay.dispatchEvent(new CustomEvent('basalt:favorites-refresh'));}).catch(function(err){fav.disabled=false;toast(err);});};
      var dl=popup.querySelector('[data-detail-download]');if(dl)dl.onclick=function(){var fileId=Number(dl.getAttribute('data-detail-download'));if(fileId>0)requestFileDownload(dl,'file',fileId,(currentRole==='admin'||isAdmin)?Number(p.seller_tg_id):0,'price-list.xlsx');};
    }).catch(function(err){if(!overlay.isConnected)return;popup.querySelector('.product-detail-content').innerHTML='<div class="empty"><strong>'+localizeUiText('Не удалось загрузить товар','Could not load product','Тауарды жүктеу мүмкін болмады')+'</strong><p class="tiny">'+esc(friendlyError(err))+'</p><button type="button" class="button secondary" data-product-detail-close>'+localizeUiText('Закрыть','Close','Жабу')+'</button></div>';var b=popup.querySelector('[data-product-detail-close]');if(b)b.onclick=close;});
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
          updateFavoritesCount(result.favorites_count);if(!next){var overlay=document.getElementById('favoritesOverlay');if(overlay){var row=overlay.querySelector('.product-card[data-product-id="'+id+'"]');if(row)row.remove();var list=overlay.querySelector('#favoritesResults');if(list&&!list.querySelector('.product-card'))list.innerHTML='<div class="empty favorites-empty-state"><div class="symbol">'+favoriteStarSvg(false)+'</div><strong>'+localizeUiText('Пока не выбрали','Not chosen yet','Әзірге таңдалмаған')+'</strong><p class="tiny">'+localizeUiText('Добавляйте товары в избранное кнопкой с сердечком в поиске.','Save products with the heart button in search.','Іздеуде жүрек түймесі арқылы тауарларды таңдаулыларға қосыңыз.')+'</p></div>';}}
        }).catch(function(error){button.disabled=false;toast(error);});
      });
    });
  }
  function openFavoritesModal() {
    var old=document.getElementById('favoritesOverlay');if(old)old.remove();
    var overlay=document.createElement('div');overlay.id='favoritesOverlay';overlay.className='modal-backdrop';
    overlay.innerHTML='<section class="filter-modal modal-filter favorites-modal" role="dialog" aria-modal="true" aria-labelledby="favoritesModalTitle"><div class="modal-grab"><span></span></div><div class="modal-content"><div class="modal-head"><div><div class="eyebrow">'+localizeUiText('ЛИЧНАЯ ПОДБОРКА','PERSONAL COLLECTION','ЖЕКЕ ТОПТАМА')+'</div><h2 id="favoritesModalTitle">'+localizeUiText('Избранные товары','Favorite items','Таңдаулы тауарлар')+'</h2></div></div><div class="search-box favorites-search-box"><span>'+iconSvg('search')+'</span><input id="favoritesQuery" placeholder="'+localizeUiText('Поиск среди избранного','Search favorites','Таңдаулылардан іздеу')+'" autocomplete="off"></div><div class="result-bar"><div class="tiny muted" id="favoritesResultCount">'+localizeUiText('Загружаем избранное…','Loading favorites…','Таңдаулылар жүктелуде…')+'</div></div><div id="favoritesResults"><div class="loading-card"><div class="spinner"></div>'+localizeUiText('Загружаем товары…','Loading items…','Тауарлар жүктелуде…')+'</div></div></div></section>';
    document.body.appendChild(overlay);var modal=overlay.querySelector('.favorites-modal');bindSheetDrag(overlay,modal);
    function close(){if(!overlay.isConnected)return;overlay.classList.add('closing');setTimeout(function(){if(overlay.isConnected)overlay.remove();},220);document.removeEventListener('keydown',onKey);}
    function onKey(e){if(e.key==='Escape')close();}document.addEventListener('keydown',onKey);overlay.addEventListener('click',function(e){if(e.target===overlay)close();});
    setTimeout(function(){if(overlay.isConnected)overlay.classList.add('is-open');},10);
    var rows=[];var query='';var currentShareGroups=Object.create(null);
    // Share destinations are real anchors. Do not cancel or intercept default navigation:
    // Telegram WebViews can silently swallow JS-opened t.me links, while a user-clicked
    // <a target="_blank"> is handled by the host application as expected.
    overlay.addEventListener('click',function(event){var link=event.target&&event.target.closest?event.target.closest('a[data-share-favorites]'):null;if(!link||!overlay.contains(link))return;var group=currentShareGroups[String(link.getAttribute('data-share-favorites')||'')];if(!group){event.preventDefault();toast(localizeUiText('Не удалось найти товары этого продавца. Обновите избранное и попробуйте снова.','Could not find this seller’s items. Refresh favorites and try again.','Бұл сатушының тауарлары табылмады. Таңдаулыларды жаңартып, қайталап көріңіз.'));return;}try{copyText(sellerGroupText(group)).then(function(){toast(localizeUiText('Список скопирован — он также откроется в Telegram.','The list was copied and will also open in Telegram.','Тізім көшірілді және Telegram ішінде де ашылады.'));}).catch(function(){});}catch(copyError){} });
    overlay.addEventListener('basalt:favorites-refresh',function(){api('favorites').then(function(updated){if(!overlay.isConnected)return;rows=Array.isArray(updated)?updated:rows;updateFavoritesCount(rows.length);renderRows();}).catch(function(){});});
    function sellerGroupText(group){
      var lines=[localizeUiText('Здравствуйте! Хочу уточнить наличие товаров из вашего прайс-листа:','Hello! I would like to check the availability of items from your price list:','Сәлеметсіз бе! Прайс-парағыңыздағы тауарлардың бар-жоғын білгім келеді:'),''];
      group.items.forEach(function(p,index){
        var detail=[p.brand,p.name].filter(Boolean).join(' — ');
        lines.push((index+1)+'. '+(detail||p.name||'Товар'));
        lines.push((isDisplayProduct(p)?localizeUiText('Размер: ','Size: ','Өлшемі: '):localizeUiText('Объём: ','Volume: ','Көлемі: '))+productMeasureText(p));
        lines.push(localizeUiText('Тип: ','Type: ','Түрі: ')+localizedProductType(p.type));
        lines.push(localizeUiText('Тестер: ','Tester: ','Тестер: ')+(Number(p.is_tester)?localizeUiText('да','yes','иә'):localizeUiText('нет','no','жоқ')));
        if(Number(p.is_set))lines.push(localizeUiText('Набор: да','Set: yes','Жиынтық: иә'));
        lines.push(localizeUiText('Цена: ','Price: ','Бағасы: ')+fmtMoney(Number(p.effective_price!==undefined?p.effective_price:(p.price_usd||0)),p.currency));
        lines.push('');
      });
      return lines.join('\n').trim();
    }
    function showShareComposer(group,text){
      var oldShare=document.getElementById('favoritesShareComposer');if(oldShare)oldShare.remove();
      var shareOverlay=document.createElement('div');shareOverlay.id='favoritesShareComposer';shareOverlay.className='modal-backdrop favorites-share-backdrop';
      shareOverlay.innerHTML='<section class="filter-modal modal-filter favorites-share-composer" role="dialog" aria-modal="true" aria-labelledby="favoritesShareTitle"><div class="modal-grab"><span></span></div><div class="modal-content"><p class="eyebrow">'+localizeUiText('ИЗБРАННОЕ','FAVORITES','ТАҢДАУЛЫЛАР')+'</p><h2 id="favoritesShareTitle">'+localizeUiText('Поделиться списком','Share list','Тізімді бөлісу')+'</h2><p class="tiny muted">'+esc(group.name||localizeUiText('Продавец','Seller','Сатушы'))+' · '+group.items.length+' '+localizeUiText('товаров. Скопируйте текст или откройте Telegram — полный список будет готов к вставке.','items. Copy the text or open Telegram — the full list will be ready to paste.','тауар. Мәтінді көшіріңіз немесе Telegram ашыңыз — толық тізім қоюға дайын болады.')+'</p><textarea class="input favorites-share-text" id="favoritesShareText" rows="10" readonly></textarea><div class="favorites-share-actions"><button type="button" class="button secondary" id="copyFavoritesShareText">'+localizeUiText('Скопировать текст','Copy text','Мәтінді көшіру')+'</button><button type="button" class="button" id="openFavoritesShareTelegram">'+localizeUiText('Открыть Telegram','Open Telegram','Telegram ашу')+' '+iconSvg('arrow')+'</button></div><p class="tiny muted" id="favoritesShareStatus" aria-live="polite"></p></div></section>';
      document.body.appendChild(shareOverlay);var shareModal=shareOverlay.querySelector('.favorites-share-composer');shareOverlay.querySelector('#favoritesShareText').value=text;bindSheetDrag(shareOverlay,shareModal);
      function closeShare(){if(!shareOverlay.isConnected)return;shareOverlay.classList.add('closing');setTimeout(function(){if(shareOverlay.isConnected)shareOverlay.remove();},220);document.removeEventListener('keydown',shareKey);}
      function shareKey(e){if(e.key==='Escape')closeShare();}document.addEventListener('keydown',shareKey);shareOverlay.addEventListener('click',function(e){if(e.target===shareOverlay)closeShare();});
      shareOverlay.querySelector('#copyFavoritesShareText').onclick=function(){var textarea=shareOverlay.querySelector('#favoritesShareText');copyText(text).then(function(){shareOverlay.querySelector('#favoritesShareStatus').textContent=localizeUiText('Список скопирован. Его можно вставить в сообщение продавцу.','The list was copied. You can paste it into a message to the seller.','Тізім көшірілді. Оны сатушыға жіберілетін хабарламаға қоюға болады.');toast(localizeUiText('Список скопирован','List copied','Тізім көшірілді'));}).catch(function(){textarea.focus();textarea.select();textarea.setSelectionRange(0,textarea.value.length);shareOverlay.querySelector('#favoritesShareStatus').textContent=localizeUiText('Не удалось скопировать автоматически. Текст выделен — скопируйте его вручную.','Automatic copying failed. The text is selected — copy it manually.','Автоматты көшіру сәтсіз аяқталды. Мәтін белгіленді — оны қолмен көшіріңіз.');});};
      shareOverlay.querySelector('#openFavoritesShareTelegram').onclick=function(){var username=String(group.username||'').replace(/^@/,'').trim();var encoded=encodeURIComponent(text);var url='';if(username&&encoded.length<1800)url='https://t.me/'+encodeURIComponent(username)+'?text='+encoded;else if(username)url='https://t.me/'+encodeURIComponent(username);else {var bot=String(botUsername||'').replace(/^@/,'').trim();var shareTarget=bot&&bot!=='YOUR_BOT_USERNAME'?'https://t.me/'+bot:'https://t.me';url='https://t.me/share/url?url='+encodeURIComponent(shareTarget)+(encoded.length<6500?'&text='+encoded:'');}
        // Copy starts immediately from the click; opening Telegram remains in the same gesture.
        copyText(text).catch(function(){});var opened=openTelegramUrl(url);if(opened){shareOverlay.querySelector('#favoritesShareStatus').textContent=username?(encoded.length<1800?localizeUiText('Открываем чат продавца с подготовленным сообщением.','Opening the seller chat with your message ready.','Сатушымен чат дайын хабарламамен ашылуда.') :localizeUiText('Чат продавца открыт. Вставьте полный список из буфера обмена.','The seller chat is open. Paste the full list from the clipboard.','Сатушымен чат ашылды. Алмасу буферінен толық тізімді қойыңыз.')):localizeUiText('Открылось меню Telegram. Выберите чат продавца; список уже скопирован.','Telegram share menu opened. Choose the seller chat; the list is already copied.','Telegram бөлісу мәзірі ашылды. Сатушымен чатты таңдаңыз; тізім көшірілді.');}else{shareOverlay.querySelector('#favoritesShareStatus').textContent=localizeUiText('Telegram не удалось открыть автоматически. Скопируйте текст и вставьте его в чат продавца.','Telegram could not be opened automatically. Copy the text and paste it into the seller chat.','Telegram автоматты түрде ашылмады. Мәтінді көшіріп, сатушымен чатқа қойыңыз.');var area=shareOverlay.querySelector('#favoritesShareText');area.focus();area.select();}};
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
      if(!group||!Array.isArray(group.items)||!group.items.length){toast(localizeUiText('В этом разделе пока нет товаров для отправки.','There are no items to share in this section yet.','Бұл бөлімде бөлісуге арналған тауарлар әзірге жоқ.'));return;}
      showShareComposer(group,sellerGroupText(group));
    }
    function renderRows(){
      var q=query.toLocaleLowerCase();
      var filtered=rows.filter(function(p){return !q||[p.brand,p.name,p.type,p.volume_text,p.volume_ml,p.size_width,p.size_height,p.category,p.seller_name,p.seller_username].join(' ').toLocaleLowerCase().indexOf(q)!==-1;});
      overlay.querySelector('#favoritesResultCount').textContent=localizedFavoritesCount(filtered.length,rows.length);
      var target=overlay.querySelector('#favoritesResults');
      if(!rows.length)target.innerHTML='<div class="empty favorites-empty-state"><div class="symbol">'+favoriteStarSvg(false)+'</div><strong>'+localizeUiText('Пока не выбрали','Not chosen yet','Әзірге таңдалмаған')+'</strong><p class="tiny">'+localizeUiText('Нажмите на сердечко в строке товара на странице поиска, чтобы сохранить его здесь.','Tap the heart on a product in search to save it here.','Іздеуде тауар жолындағы жүректі басып, оны осында сақтаңыз.')+'</p></div>';
      else if(!filtered.length)target.innerHTML='<div class="empty"><strong>'+localizeUiText('Ничего не найдено','No results found','Ештеңе табылмады')+'</strong><p class="tiny">'+localizeUiText('Попробуйте изменить запрос.','Try changing your search.','Іздеу сұрауын өзгертіп көріңіз.')+'</p></div>';
      else {
        var groupMap={},groups=[];
        filtered.forEach(function(p){var id=String(p.seller_tg_id||'unknown');if(!groupMap[id]){groupMap[id]={sellerId:Number(p.seller_tg_id||0),name:p.seller_name|| (p.seller_username?'@'+p.seller_username:'Продавец'),username:p.seller_username||'',dmAvailable:!!Number(p.seller_dm_available)||!!isAdmin,items:[]};groups.push(groupMap[id]);}groupMap[id].items.push(p);});
        currentShareGroups=Object.create(null);
        target.innerHTML=translateHtml(groups.map(function(group){
          group.shareKey=String(group.sellerId||'unknown');currentShareGroups[group.shareKey]=group;
          var cards=group.items.map(function(p){return productCardMarkup(p,true);}).join('');
          var sellerItemsLabel=localizedItemCount(group.items.length);var shareAction=group.dmAvailable?'<a class="button secondary favorite-share-button telegram-link" href="'+esc(sellerShareHref(group))+'" target="_blank" rel="noopener noreferrer" data-share-favorites="'+esc(group.shareKey)+'">'+localizeUiText('Поделиться списком','Share list','Тізімді бөлісу')+' '+iconSvg('arrow')+'</a>':'<button type="button" class="button secondary favorite-share-button favorite-share-disabled" disabled aria-disabled="true" title="'+localizeUiText('Продавец отключил личные сообщения','The seller disabled direct messages','Сатушы жеке хабарламаларды өшірді')+'">'+localizeUiText('Поделиться списком','Share list','Тізімді бөлісу')+' '+iconSvg('arrow')+'</button>';return '<section class="favorite-seller-group"><div class="favorite-seller-heading"><div class="favorite-seller-title"><strong>'+esc(group.name)+'</strong><span class="favorite-seller-count"> — '+sellerItemsLabel+'</span></div></div><div class="favorite-seller-products">'+cards+'</div><div class="favorite-seller-share-row">'+shareAction+'</div></section>';
        }).join(''));
        target.querySelectorAll('[data-favorite-id]').forEach(function(button){button.onclick=function(event){event.preventDefault();event.stopPropagation();var id=Number(button.getAttribute('data-favorite-id'));button.disabled=true;api('favorite_toggle',{product_id:id,favorite:false}).then(function(result){rows=rows.filter(function(p){return Number(p.id)!==id;});updateFavoritesCount(result.favorites_count);delete cache.favorites;renderRows();}).catch(function(error){button.disabled=false;toast(error);});};});
        bindProductCards(target);
      }
    }
    overlay.querySelector('#favoritesQuery').addEventListener('input',function(){query=this.value||'';renderRows();});
    api('favorites').then(function(data){if(!overlay.isConnected)return;rows=Array.isArray(data)?data:[];updateFavoritesCount(rows.length);renderRows();}).catch(function(error){if(!overlay.isConnected)return;overlay.querySelector('#favoritesResults').innerHTML='<div class="empty"><strong>Не удалось загрузить избранное</strong><p class="tiny">'+esc(friendlyError(error))+'</p></div>';overlay.querySelector('#favoritesResultCount').textContent=localizeUiText('Ошибка загрузки','Loading error','Жүктеу қатесі');});
  }

  function renderSearch(mode) {
    mode = mode || 'products';
    var html = heading(mode === 'best' ? 'СРАВНЕНИЕ' : 'КАТАЛОГ', 'Поиск товаров', mode === 'best' ? 'Сравните найденные позиции по стоимости.' : 'Ищите по названию, бренду, артикулу или любому фрагменту наименования.');
    html += '<div class="search-toolbar"><div class="search-box"><span>' + iconSvg('search') + '</span><input id="productQuery" placeholder="Например, Dior Sauvage или 100 ml" autocomplete="off"></div><button class="button secondary filter-launch" id="openFilters">' + iconSvg('filter') + '<span>Фильтры</span><b id="filterCount">0</b></button></div><div class="result-bar"><div class="tiny muted" id="resultCount">Загружаем каталог…</div></div><div id="productResults"></div>';
    app.innerHTML = translateHtml(html);
    var sort = 'price_asc';
    var buyerSearch=currentRole==='buyer';var sellerFilterSearch=buyerSearch||currentRole==='admin'||isAdmin;var filters = {brand:[], volume:[], type:[], file_id:[], gender:[], category:[], defects:['__none__'], tester:'', is_set:'', needs_review:'', min_price:'', max_price:'', seller_ids:[]}; if(buyerSearch){delete filters.file_id;delete filters.needs_review;}
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
  function renderSupport(){return load('support',{},true).then(function(data){var html=heading('МЫ НА СВЯЗИ','Поддержка','Поможем разобраться с обработкой прайсов, подпиской и возможностями приложения.');var developerName=data.developer_username?data.developer_username.replace(/^@/,''):'';var draft=settings.language==='en'?'Hello! I use Basalt Perfume and have a question about: ':settings.language==='kz'?'Сәлеметсіз бе! Basalt Perfume қолданамын, қосымшаға қатысты сұрағым бар: ':'Здравствуйте! Я пользуюсь Basalt Perfume, есть вопрос по работе приложения: ';var developerHref=developerName?'https://t.me/'+encodeURIComponent(developerName)+'?text='+encodeURIComponent(draft):'#';html+='<div class="card"><div class="row"><div><div class="card-title">Связаться с разработчиком</div><div class="tiny muted">Вопросы, идеи и сообщения об ошибках</div></div><div class="setting-icon">'+iconSvg('arrow')+'</div></div><div class="divider"></div><a class="button full telegram-link" id="developerLink" href="'+esc(developerHref)+'" target="_blank" rel="noopener noreferrer">Написать '+(developerName?'@'+esc(developerName):'разработчику')+' '+iconSvg('arrow')+'</a></div><div class="section-head"><h2>Частые вопросы</h2></div><div class="card faq-list-card">'+data.faq.map(function(item,i){return '<div class="faq-item"><button type="button" class="faq-q" data-faq="'+i+'" aria-expanded="false">'+esc(item.q)+'<span>'+iconSvg('chevron')+'</span></button><div class="faq-a"><div class="faq-a-inner">'+esc(item.a)+'</div></div></div>';}).join('')+'</div>';
      app.innerHTML=translateHtml(html);document.querySelectorAll('[data-faq]').forEach(function(b){b.onclick=function(){var open=b.parentNode.classList.toggle('open');b.setAttribute('aria-expanded',open?'true':'false');};});var developerLink=document.getElementById('developerLink');if(developerLink&&developerLink.getAttribute('href')==='#')developerLink.onclick=function(event){event.preventDefault();toast('Укажите DEVELOPER_USERNAME в конфигурации сайта.');};return html;});}
  function bindAdminKeyRoleDropdown(){var drop=document.getElementById('keyRoleSelect');if(!drop)return;var trigger=drop.querySelector('.custom-select-trigger');if(!trigger)return;trigger.onclick=function(event){event.preventDefault();event.stopPropagation();var open=!drop.classList.contains('open');document.querySelectorAll('[data-select-key],[data-filter-select-key],[data-seller-select]').forEach(function(other){if(other!==drop){other.classList.remove('open');var t=other.querySelector('.custom-select-trigger');if(t)t.setAttribute('aria-expanded','false');}});drop.classList.toggle('open',open);trigger.setAttribute('aria-expanded',open?'true':'false');};drop.querySelectorAll('[data-value]').forEach(function(option){option.onclick=function(event){event.preventDefault();event.stopPropagation();var value=option.getAttribute('data-value')||'buyer';drop.setAttribute('data-selected-value',value);trigger.querySelector('span').textContent=option.getAttribute('data-label')||'Покупатель';drop.querySelectorAll('[data-value]').forEach(function(other){var active=other===option;other.classList.toggle('selected',active);other.setAttribute('aria-selected',active?'true':'false');var check=other.querySelector('.svg-icon');if(check)check.remove();if(active)other.insertAdjacentHTML('beforeend',iconSvg('check'));});drop.classList.remove('open');trigger.setAttribute('aria-expanded','false');};});}
  function adminKeyRowsMarkup(keys) {
    keys = keys || [];
    return keys.map(function (k, i) {
      var canReveal = !!(k.can_reveal || k.full_key);
      var shownKey = k.full_key || (String(k.key_prefix || 'Ключ') + '–····');
      var unavailable = '';
      if (!canReveal) {
        var reason = k.key_unavailable_reason || 'key_legacy_unrecoverable';
        var note = reason === 'key_decryption_failed' ? 'Не удалось расшифровать ключ. Проверьте прежний KEY_ENCRYPTION_SECRET, BOT_TOKEN и пароль БД.' : 'Полный ключ не сохранялся для этой старой записи. Восстановить его из хеша нельзя.';
        unavailable = '<div class="tiny muted admin-key-legacy-note">' + esc(note) + '</div>';
      }
      var isQueued = !!Number(k.is_queued);
      var status = isQueued ? 'В очереди' : (k.used_by_tg_id ? 'Активирован' : 'Свободен');
      return '<div class="admin-key-row" data-admin-key-row="' + Number(k.id) + '">' +
        '<div class="admin-key-actions"><button type="button" class="admin-key-action" data-key-reveal="' + Number(k.id) + '" title="Показать ключ" aria-label="Показать ключ" ' + (canReveal ? '' : 'disabled') + '>' + iconSvg('eye-off') + '</button><button type="button" class="admin-key-action" data-key-copy="' + Number(k.id) + '" title="Копировать ключ" aria-label="Копировать ключ" ' + (canReveal ? '' : 'disabled') + '>' + iconSvg('copy') + '</button></div>' +
        '<div class="admin-key-main"><strong class="admin-key-value ' + (canReveal ? 'is-blurred' : 'is-blurred is-legacy') + '" data-key-value="' + Number(k.id) + '" data-raw-key="' + esc(k.full_key || '') + '" title="' + (canReveal ? 'Нажмите на глаз, чтобы показать ключ' : 'Ключ недоступен для показа') + '">' + esc(shownKey) + '</strong><div class="tiny muted">' + Number(k.duration_days) + ' дн. · ' + status + (k.role_on_activate ? ' · роль: ' + esc(String(k.role_on_activate).toUpperCase()) : '') + (isQueued ? ' · с ' + esc(fmtDate(k.starts_at)) : '') + '</div>' + unavailable + '</div>' +
        '<span class="status-label">' + (k.usable ? 'Доступен' : 'Использован') + '</span></div>' + (i < keys.length - 1 ? '<div class="divider"></div>' : '');
    }).join('');
  }
  function renderAdmin() {
    return api('admin_stats').then(function (d) {
      var html = heading('CONTROL ROOM', 'Панель администратора', 'Состояние сервиса и инструменты управления подписками.');
      html += '<div class="stats-grid"><div class="stat-card"><div class="stat-value">' + d.users + '</div><div class="stat-label">Пользователи</div></div><div class="stat-card"><div class="stat-value">' + d.active_subscriptions + '</div><div class="stat-label">Активные подписки</div></div><div class="stat-card"><div class="stat-value">' + d.price_lists + '</div><div class="stat-label">Прайс-листы</div></div><div class="stat-card"><div class="stat-value">' + d.review_rows + '</div><div class="stat-label">Строк на проверку</div></div></div>';
      var maintenance=d.maintenance||{};
      var maintenanceActive=!!maintenance.maintenance_mode;
      html += '<div class="section-head"><h2>Тех. работы</h2><span class="status-label '+(maintenanceActive?'is-maintenance-active':'')+'">'+(maintenanceActive?'Ведутся':'Не назначено')+'</span></div><div class="card admin-maintenance-card"><div class="card-title">'+esc(maintenance.maintenance_title||'Технические работы')+'</div><p class="tiny muted">'+esc(maintenance.maintenance_message||(maintenanceActive?'Доступ для пользователей временно ограничен.':'Пользователи и бот работают в обычном режиме.'))+'</p><div class="tiny muted">'+(maintenanceActive&&maintenance.maintenance_until?'Окончание: '+esc(fmtDateTime(maintenance.maintenance_until)):'')+'</div><div class="admin-maintenance-actions"><button type="button" class="button full" id="openMaintenanceModal">'+(maintenanceActive?'Изменить':'Назначить')+'</button>'+(maintenanceActive?'<button type="button" class="button secondary full" id="stopMaintenance">Завершить</button>':'')+'</div></div>';
      var browserFeatures=d.browser_features||{};
      html += '<div class="section-head"><h2>Доступ к сайту</h2><span class="status-label">Настройки</span></div><div class="card admin-browser-settings"><label class="admin-toggle"><span class="admin-toggle-copy"><strong>Доступ из обычного браузера</strong><small>Разрешить вход на сайте по Telegram-аккаунту, вне WebApp.<br>Сессия браузера хранится в cookie 7 дней.</small></span><input type="checkbox" id="browserAccessToggle" '+(browserFeatures.browser_access_enabled?'checked':'')+'><span class="admin-toggle-ui" aria-hidden="true"></span></label><div class="divider admin-browser-settings-divider"></div><label class="admin-toggle"><span class="admin-toggle-copy"><strong>Синхронизация</strong><small>Если включено, одновременно активной может быть только одна сессия. При открытии сайта в другой сессии предыдущая станет неактивной; нажмите «Продолжить здесь», чтобы переключиться.</small></span><input type="checkbox" id="sessionSyncToggle" '+(browserFeatures.session_sync_enabled!==false?'checked':'')+'><span class="admin-toggle-ui" aria-hidden="true"></span></label></div>';
      html += '<div class="section-head"><h2>Создать ключи</h2></div><div class="card"><div class="form-row"><label><div class="tiny muted">Количество</div><input class="input" id="keyCount" type="number" min="1" max="100" value="10"></label><label><div class="tiny muted">Срок, дней</div><input class="input" id="keyDays" type="number" min="1" max="3650" value="30"></label></div><div class="key-role-picker"><div class="tiny muted">Роль после активации ключа</div>'+customDropdown('keyRoleSelect','keyRole',[{value:'buyer',label:'Покупатель'},{value:'seller',label:'Продавец'},{value:'admin',label:'Администратор'}],'buyer')+'</div><button class="button full" id="generateKeys">Сгенерировать ключи</button><div id="generatedKeys"></div></div>';
      html += '<div class="section-head"><h2>Опубликовать обновление</h2></div><div class="card"><div class="tiny muted">Сообщение появится в центре уведомлений у пользователей, которые включили уведомления об обновлениях.</div><div style="height:10px"></div><input class="input" id="announcementTitle" placeholder="Заголовок обновления"><div style="height:8px"></div><textarea class="input announcement-body-input" id="announcementBody" rows="4" placeholder="Текст сообщения"></textarea><div style="height:10px"></div><button class="button full" id="publishAnnouncement">Опубликовать</button></div>';

      var keys = d.keys_list || [];
      html += '<div class="section-head"><h2>Ключи активации</h2><span class="status-label section-count admin-key-count">Всего: '+Number(d.keys||keys.length)+'</span></div><div class="card admin-key-list"><div class="admin-key-scroll">' + adminKeyRowsMarkup(keys) + '</div></div>';

      var users = d.users_list || [];
      html += '<div class="section-head"><h2>Пользователи</h2><span class="status-label section-count admin-user-count">Всего: ' + users.length + '</span></div><div class="card admin-users"><div class="admin-users-scroll">' + users.map(function (u, i) {
        var photo = avatarMarkup(u, 'admin-user-avatar', '?', false);
        var role = String(u.role || 'none').toLowerCase(); if(!['admin','seller','buyer','none'].includes(role))role='none';
        var fullName=[u.first_name,u.last_name].filter(Boolean).join(' ') || 'Пользователь Telegram';
        return '<button type="button" class="admin-user-row" data-admin-user="' + Number(u.tg_id) + '">' + photo + '<span class="admin-user-info"><strong>' + esc(fullName) + '</strong><small>' + esc(u.username ? '@'+u.username : 'ID '+u.tg_id) + '</small></span><span class="role-badge ' + role + '">' + (role==='admin'?'ADMIN':(role==='buyer'?'BUYER':(role==='none'?'NONE':'SELLER'))) + '</span><span class="tiny muted admin-user-date"><small>Доступ до:</small><strong>' + (u.available_until ? esc(fmtDate(u.available_until)) : 'без подписки') + '</strong></span></button>' + (i < users.length - 1 ? '<div class="divider"></div>' : '');
      }).join('') + '</div></div>';

      app.innerHTML = translateHtml(html);
      if(isDesktopWideShell()){
        var nodes=Array.prototype.slice.call(app.children);
        if(nodes.length>=16){
          var full=document.createElement('div');full.className='admin-layout-full';
          nodes.slice(0,4).forEach(function(node){full.appendChild(node);});
          var columns=document.createElement('div');columns.className='admin-layout-columns';
          var left=document.createElement('div');left.className='admin-column admin-column-left';
          var right=document.createElement('div');right.className='admin-column admin-column-right';
          var pairs=[],pairNames=['maintenance','site-access','create-keys','publish-update','activation-keys','users'];for(var pairStart=4;pairStart+1<nodes.length;pairStart+=2){var block=document.createElement('section');block.className='admin-block';block.setAttribute('data-admin-section',pairNames[pairs.length]||('section-'+pairs.length));block.appendChild(nodes[pairStart]);block.appendChild(nodes[pairStart+1]);pairs.push(block);}
          // A deliberate assignment keeps each column flowing top-to-bottom independently.
          [0,2,4,5].forEach(function(i){if(pairs[i])left.appendChild(pairs[i]);});
          [1,3].forEach(function(i){if(pairs[i])right.appendChild(pairs[i]);});
          columns.appendChild(left);columns.appendChild(right);app.replaceChildren(full,columns);app.classList.add('admin-layout-ready');
          var syncPublishHeight=function(){if(!isDesktopWideShell())return;var activationBlock=left.querySelector('[data-admin-section="activation-keys"]'),publishBlock=right.querySelector('[data-admin-section="publish-update"]');if(!activationBlock||!publishBlock)return;var desiredHeight=Math.max(0,Math.ceil(activationBlock.getBoundingClientRect().bottom-publishBlock.getBoundingClientRect().top)),nextHeight=desiredHeight+'px';if(publishBlock.style.minHeight!==nextHeight)publishBlock.style.minHeight=nextHeight;};requestAnimationFrame(syncPublishHeight);window.addEventListener('resize',syncPublishHeight,{passive:true});if(window.ResizeObserver){var adminColumnObserver=new ResizeObserver(syncPublishHeight);adminColumnObserver.observe(left);}
        }
      }
      var openMaintenance=document.getElementById('openMaintenanceModal');if(openMaintenance)openMaintenance.onclick=function(){openMaintenanceModal(maintenance);};
      bindAdminKeyRoleDropdown();
      var browserAccessToggle=document.getElementById('browserAccessToggle');
      if(browserAccessToggle)browserAccessToggle.onchange=function(){var toggle=browserAccessToggle;toggle.disabled=true;api('save_browser_features',{browser_access_enabled:toggle.checked,session_sync_enabled:browserFeatures.session_sync_enabled!==false}).then(function(result){d.browser_features=result.browser_features||{browser_access_enabled:toggle.checked,session_sync_enabled:browserFeatures.session_sync_enabled!==false};browserFeatures=d.browser_features;delete cache.admin_stats;delete cache.overview;toast(localizeUiText('Настройки доступа сохранены','Access settings saved','Қолжетімділік баптаулары сақталды'));}).catch(function(error){toggle.checked=!!browserFeatures.browser_access_enabled;toast(friendlyError(error));}).finally(function(){toggle.disabled=false;});};
      var sessionSyncToggle=document.getElementById('sessionSyncToggle');
      if(sessionSyncToggle)sessionSyncToggle.onchange=function(){var toggle=sessionSyncToggle;toggle.disabled=true;api('save_browser_features',{browser_access_enabled:!!browserFeatures.browser_access_enabled,session_sync_enabled:toggle.checked}).then(function(result){d.browser_features=result.browser_features||{session_sync_enabled:toggle.checked};browserFeatures=d.browser_features;delete cache.admin_stats;delete cache.overview;toast(localizeUiText('Настройки синхронизации сохранены','Synchronization settings saved','Синхрондау баптаулары сақталды'));}).catch(function(error){toggle.checked=browserFeatures.session_sync_enabled!==false;toast(friendlyError(error));}).finally(function(){toggle.disabled=false;});};
      var stopMaintenance=document.getElementById('stopMaintenance');if(stopMaintenance)stopMaintenance.onclick=function(){stopMaintenance.disabled=true;api('save_maintenance',{enabled:false,title:maintenance.maintenance_title||'Технические работы',message:maintenance.maintenance_message||''}).then(function(){toast('Технические работы завершены');delete cache.admin_stats;renderScreen('admin');}).catch(function(err){stopMaintenance.disabled=false;toast(friendlyError(err));});};
      document.getElementById('generateKeys').onclick = function () {
        api('generate_keys', {count:Number(document.getElementById('keyCount').value), days:Number(document.getElementById('keyDays').value), role_on_activate:(document.getElementById('keyRoleSelect').getAttribute('data-selected-value')||'buyer')}).then(function (r) {
          var generatedMarkup = '<div class="generated-keys-result"><div class="divider"></div><div class="tiny muted generated-keys-note">Скопируйте ключи сейчас: полные значения показываются только один раз.</div><textarea class="input keys-output-input" rows="8" id="keysOutput" readonly>' + esc((r.keys || []).join('\n')) + '</textarea><button class="button secondary full" id="copyKeys" style="margin-top:10px">Копировать ключи</button></div>';
          document.getElementById('generatedKeys').innerHTML = translateHtml(generatedMarkup);
          document.getElementById('copyKeys').onclick = function () {
            var output = document.getElementById('keysOutput');
            copyText(output.value).then(function () { toast('Ключи скопированы'); }).catch(function () { output.focus(); output.select(); var copied = false; try { copied = document.execCommand('copy'); } catch (e) {} toast(copied ? 'Ключи скопированы' : 'Не удалось скопировать ключи. Выделите их и скопируйте вручную.'); });
          };
          // Refresh only the key list; leave generated plaintext available for the one-time copy action.
          api('admin_stats').then(function (latest) {
            var keyScroll = app.querySelector('.admin-key-scroll');
            if (keyScroll) keyScroll.innerHTML = adminKeyRowsMarkup(latest.keys_list || []);
            var countLabel = app.querySelector('.admin-key-count');
            if (countLabel) countLabel.textContent = 'Всего: ' + Number(latest.keys || (latest.keys_list || []).length);
            overlayKeyActions();
          }).catch(function (refreshError) { toast('Ключи созданы, но список не обновился: ' + friendlyError(refreshError)); });
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
  function calendarWeekMarkup(){var labels=settings.language==='en'?['Mon','Tue','Wed','Thu','Fri','Sat','Sun']:(settings.language==='kz'?['Дс','Сс','Ср','Бс','Жм','Сн','Жс']:['Пн','Вт','Ср','Чт','Пт','Сб','Вс']);return '<div class="ban-cal-week">'+labels.map(function(label){return '<span>'+label+'</span>';}).join('')+'</div>'; }
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
    overlay.innerHTML='<section class="filter-modal modal-filter maintenance-modal" role="dialog" aria-modal="true" aria-labelledby="maintenanceTitle"><div class="modal-grab"><span></span></div><div class="modal-content"><div class="eyebrow">УПРАВЛЕНИЕ ДОСТУПОМ</div><h2 id="maintenanceTitle">Технические работы</h2><p class="tiny muted">Пока режим активен, обычные пользователи не смогут работать в WebApp и боте. Администраторам доступ останется.</p><label class="filter-field"><span>Заголовок</span><input class="input" id="maintenanceHeading" maxlength="190" placeholder="Например, обновление каталога" value="'+esc(state.maintenance_title||'Технические работы')+'"></label><label class="filter-field"><span>Подробное описание</span><textarea class="input" id="maintenanceMessage" rows="4" maxlength="4000" placeholder="Что обновляется и почему сервис временно недоступен">'+esc(state.maintenance_message||'')+'</textarea></label><div class="section-head"><h3>Длительность</h3></div><div class="filter-tabs ban-mode-tabs maintenance-mode-tabs" data-active-tab="filters"><button type="button" class="filter-tab active" data-maint-mode="keyboard">Клавиатура</button><button type="button" class="filter-tab" data-maint-mode="analog">Аналог</button></div><section data-maint-panel="keyboard"><div class="ban-duration-grid"><label class="filter-field"><span>Минуты</span><input class="input" id="maintenanceMinutes" type="number" min="0" max="525600" value="'+initialMinutes+'"></label><label class="filter-field"><span>Часы</span><input class="input" id="maintenanceHours" type="number" min="0" max="8760" value="'+initialHours+'"></label><label class="filter-field"><span>Дни</span><input class="input" id="maintenanceDays" type="number" min="0" max="3650" value="'+initialDays+'"></label></div></section><section data-maint-panel="analog" hidden><div class="ban-calendar-clock has-date"><div class="ban-calendar"><div class="ban-cal-head"><button type="button" class="mini-button" data-maint-cal-prev aria-label="Предыдущий месяц"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button><strong data-maint-cal-label></strong><button type="button" class="mini-button" data-maint-cal-next aria-label="Следующий месяц"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button></div>'+calendarWeekMarkup()+'<div class="ban-cal-grid" data-maint-calendar-grid></div></div><div class="ban-clock-panel"><div class="ban-clock-mode" data-clock-active="hours" data-maint-clock-active="hours"><button type="button" class="active" data-maint-clock-mode="hours">Часы</button><button type="button" data-maint-clock-mode="minutes">Минуты</button></div><div class="ban-clock" data-maint-clock tabindex="0" aria-label="Выбор времени окончания"><div class="ban-clock-numbers" data-maint-clock-numbers></div><div class="ban-clock-hand hour-hand" data-maint-clock-hand="hours"></div><div class="ban-clock-hand minute-hand" data-maint-clock-hand="minutes"></div><div class="ban-clock-center"></div></div><div class="ban-clock-time" data-maint-clock-time></div></div></div></section><div class="ban-summary" id="maintenanceSummary"></div></div><div class="modal-actions"><button type="button" class="button secondary" data-maint-close>Отмена</button><button type="button" class="button" id="saveMaintenance">Назначить</button></div></section>';
    overlay.innerHTML=translateHtml(overlay.innerHTML);document.body.appendChild(overlay);var modal=overlay.querySelector('.maintenance-modal');bindSheetDrag(overlay,modal);
    function close(){if(!overlay.isConnected)return;overlay.classList.add('closing');setTimeout(function(){if(overlay.isConnected)overlay.remove();},220);document.removeEventListener('keydown',onKey);}
    function onKey(e){if(e.key==='Escape')close();}document.addEventListener('keydown',onKey);overlay.querySelectorAll('[data-maint-close]').forEach(function(b){b.onclick=close;});overlay.addEventListener('click',function(e){if(e.target===overlay)close();});
    function selectedUntil(){return selectedDate?new Date(selectedDate.getFullYear(),selectedDate.getMonth(),selectedDate.getDate(),hours,minutes,0,0):null;}
    function getUntil(){if(mode==='analog')return selectedUntil();var total=Math.max(0,Number(modal.querySelector('#maintenanceMinutes').value||0)*60+Number(modal.querySelector('#maintenanceHours').value||0)*3600+Number(modal.querySelector('#maintenanceDays').value||0)*86400);return total>0?new Date(Date.now()+total*1000):null;}
    function updateSummary(){var d=getUntil(),el=modal.querySelector('#maintenanceSummary');if(!d||isNaN(d.getTime())){el.textContent=translateHtml('Укажите срок окончания технических работ.');return;}var remaining=d.getTime()-Date.now();if(remaining<=0){el.textContent=translateHtml('Время окончания должно быть в будущем.');return;}el.textContent=translateHtml('Технические работы завершатся ')+d.toLocaleString(localeTag(),{dateStyle:'medium',timeStyle:'short'})+'.';}
    function renderCalendar(){var y=calDate.getFullYear(),m=calDate.getMonth();var monthLabel=calDate.toLocaleDateString(localeTag(),{month:'long'});monthLabel=monthLabel.charAt(0).toLocaleUpperCase(localeTag())+monthLabel.slice(1);modal.querySelector('[data-maint-cal-label]').textContent=monthLabel+', '+y;var first=new Date(y,m,1),offset=(first.getDay()+6)%7,total=new Date(y,m+1,0).getDate(),grid='';for(var i=0;i<offset;i++)grid+='<span class="ban-cal-blank"></span>';for(var day=1;day<=total;day++){var active=selectedDate&&selectedDate.getFullYear()===y&&selectedDate.getMonth()===m&&selectedDate.getDate()===day;var now=new Date(),past=new Date(y,m,day,23,59)<new Date(now.getFullYear(),now.getMonth(),now.getDate());grid+='<button type="button" data-maint-cal-day="'+day+'" class="ban-cal-day '+(active?'selected ':'')+(past?'past':'')+'" '+(past?'disabled':'')+'>'+day+'</button>';}modal.querySelector('[data-maint-calendar-grid]').innerHTML=grid;modal.querySelectorAll('[data-maint-cal-day]').forEach(function(b){b.onclick=function(){selectedDate=new Date(y,m,Number(b.getAttribute('data-maint-cal-day')));renderCalendar();updateSummary();};});}
    function renderClock(){var numbers=modal.querySelector('[data-maint-clock-numbers]');numbers.innerHTML='';for(var i=0;i<12;i++){var val=clockMode==='hours'?i*2:i*5,angle=i/12*Math.PI*2-Math.PI/2,x=50+38*Math.cos(angle),y=50+38*Math.sin(angle),button=document.createElement('button');button.type='button';button.className='ban-clock-number';button.style.left=x+'%';button.style.top=y+'%';button.textContent=pad(val);button.setAttribute('data-maint-clock-value',String(val));button.addEventListener('pointerdown',function(event){event.stopPropagation();});button.onclick=function(event){event.stopPropagation();applyClockValue(Number(this.getAttribute('data-maint-clock-value')));};numbers.appendChild(button);}modal.querySelector('[data-maint-clock-hand="hours"]').style.transform='translateX(-50%) rotate('+((hours%24)/24*360)+'deg)';modal.querySelector('[data-maint-clock-hand="minutes"]').style.transform='translateX(-50%) rotate('+(minutes/60*360)+'deg)';modal.querySelector('[data-maint-clock-time]').textContent=pad(hours)+':'+pad(minutes);}
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
      var userSubscriptionKeys=Array.isArray(data.subscription_keys)?data.subscription_keys:[];
      var activeSubscriptionKey=userSubscriptionKeys.find(function(k){return k.status==='active';})||null;
      var queuedSubscriptionKeys=userSubscriptionKeys.filter(function(k){return k.status==='queued';});var frozenSubscriptionKeys=userSubscriptionKeys.filter(function(k){return k.status==='frozen';});
      function adminSubscriptionKeyRow(k,label){var code=k.full_key?'<code class="admin-full-subscription-key">'+esc(k.full_key)+'</code>':'<span class="tiny muted">Полный код не сохранён или не удалось расшифровать</span>';var dates=(k.starts_at?'Начало: '+esc(fmtDateTime(k.starts_at)):'')+(k.available_until?' · окончание: '+esc(fmtDateTime(k.available_until)):'');return '<article class="admin-subscription-key-row"><div class="admin-subscription-key-head"><strong>'+esc(label)+'</strong><span class="tiny muted">'+Number(k.duration_days||0)+' дн.</span></div>'+code+(dates?'<div class="tiny muted admin-subscription-key-dates">'+dates+'</div>':'')+'</article>';}
      var subscriptionKeysHtml='<section class="admin-user-subscription-keys"><div class="section-head"><h3>Ключи подписки</h3></div>'+(activeSubscriptionKey?adminSubscriptionKeyRow(activeSubscriptionKey,'Текущий ключ'):'<div class="tiny muted">Активного ключа нет</div>')+'<div class="section-head"><h3>Очередь продления</h3><span class="status-label section-count">'+queuedSubscriptionKeys.length+'</span></div>'+(queuedSubscriptionKeys.length?queuedSubscriptionKeys.map(function(k,index){return adminSubscriptionKeyRow(k,'В очереди · '+(index+1));}).join(''):'<div class="tiny muted">Очередь пуста</div>')+(frozenSubscriptionKeys.length?'<div class="section-head"><h3>Замороженные ключи</h3></div>'+frozenSubscriptionKeys.map(function(k,index){return adminSubscriptionKeyRow(k,'Заморожен · '+(index+1));}).join(''):'')+'</section>';
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
      var assignmentHtml=!isTargetAdmin?'<section class="admin-user-key-section"><div class="section-head"><h3>Назначить свободный ключ</h3></div><div class="tiny muted">Назначение свободного ключа немедленно заменит текущую подписку и начнёт новый период.</div><div class="admin-key-assign-row">'+customDropdown('adminAssignKey','admin-key-assignment',keyOptions,'')+'<button type="button" class="button" id="adminAssignKeyButton" '+(!availableKeys.length?'disabled':'')+'>Назначить</button></div></section>':'';
      var priceListsHtml='<section class="admin-user-files-section"><div class="section-head"><h3>Прайс-листы пользователя</h3><span class="status-label section-count">Всего: '+userLists.length+'</span></div>'+(userLists.length?'<div class="file-list admin-user-file-list">'+userLists.map(function(f){var ready=String(f.status)==='ready';return '<article class="file-card"><div class="file-icon excel-file-icon">'+excelIconSvg()+'</div><div class="file-info"><div class="file-name">'+esc(f.filename||('Прайс-лист #'+f.id))+'</div><div class="file-meta">'+Number(f.product_count||0)+' товаров · '+esc(fmtDate(f.imported_at))+'</div><div class="file-meta">'+(ready?'Обработан':esc(fileStatusLabel(f.status)))+'</div></div><div class="file-actions">'+(ready?'<button type="button" class="mini-button" data-admin-download-file="'+Number(f.id)+'">Скачать</button>':'')+'<button type="button" class="mini-button" data-admin-delete-file="'+Number(f.id)+'">Удалить</button></div></article>';}).join('')+'</div>':'<div class="empty"><strong>Прайс-листов пока нет</strong><p class="tiny">Файлы этого пользователя появятся здесь после загрузки через сайт.</p></div>')+(readyUserLists.length?'<div class="download-all-wrap"><button type="button" class="button full" data-admin-download-all>Скачать все ('+readyUserLists.length+')</button></div>':'')+'</section>';
      wait.innerHTML='<section class="filter-modal admin-user-modal" role="dialog" aria-modal="true" aria-labelledby="adminUserTitle"><div class="modal-grab"><span></span></div><div class="modal-content"><div class="admin-user-profile"><div class="admin-user-avatar-row">'+photo+'</div><div class="admin-user-name-row"><h2 id="adminUserTitle" class="admin-user-display-name">'+esc(name)+'</h2><a class="admin-user-telegram-link" href="'+esc(u.username?'https://t.me/'+encodeURIComponent(String(u.username).replace(/^@/,'')):'tg://user?id='+Number(u.tg_id))+'" target="_blank" rel="noopener noreferrer" aria-label="Открыть пользователя в Telegram" title="Открыть в Telegram"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.74 4.27 18.5 19.54c-.24 1.08-.88 1.35-1.78.84l-4.92-3.63-2.37 2.28c-.26.26-.48.48-.98.48l.35-5.01 9.12-8.24c.4-.35-.09-.55-.62-.2L6.02 13.14l-4.82-1.51c-1.05-.33-1.07-1.05.22-1.55L20.26 2.7c.87-.32 1.63.21 1.48 1.57Z"/></svg></a></div><div class="tiny muted">'+esc(u.username?'@'+String(u.username).replace(/^@/,''):'Без username')+' · ID '+Number(u.tg_id)+'</div></div>'+subscriptionHtml+extensionHtml+subscriptionKeysHtml+assignmentHtml+priceListsHtml+userFavoritesHtml+'<div class="filter-field admin-role-field"><span>Роль пользователя</span>'+customDropdown('adminUserRole','admin-user-role',[{value:'none',label:'Без роли'},{value:'buyer',label:'Покупатель'},{value:'seller',label:'Продавец'},{value:'admin',label:'Администратор'}],role)+'</div><div class="admin-role-actions"><button class="button full" id="saveUserRole">Сохранить роль</button><div class="tiny muted admin-role-lock-note" hidden>Роль администратора нельзя менять.</div></div><div class="admin-ban-status '+(banned?'is-banned':'')+'">'+(banned?'Пользователь заблокирован'+(u.banned_until?' до '+esc(fmtDateTime(u.banned_until)):' бессрочно'):'Пользователь не заблокирован')+'</div><details class="admin-ban-details" '+(banned?'open':'')+'><summary>Блокировка пользователя</summary><div class="admin-ban-form"><label class="filter-field"><span>Причина блокировки</span><input class="input" id="banReason" maxlength="500" placeholder="Например, нарушение правил" value="'+esc(u.ban_reason||'')+'"></label><label class="filter-field"><span>Подробности и дополнительная информация</span><textarea class="input" id="banDetails" rows="4" placeholder="Внутренние заметки, обстоятельства, уточнения">'+esc(u.ban_details||'')+'</textarea></label><label class="admin-permanent"><input type="checkbox" id="banPermanent"><span class="seller-filter-checkbox" aria-hidden="true"></span><span class="admin-permanent-label">Бессрочная блокировка</span></label><div class="admin-ban-schedule" data-ban-schedule><div class="filter-tabs ban-mode-tabs" data-active-tab="filters"><button class="filter-tab active" type="button" data-ban-mode="keyboard">Клавиатура</button><button class="filter-tab" type="button" data-ban-mode="calendar">Аналог</button></div><section data-ban-panel="keyboard"><div class="ban-duration-grid"><label class="filter-field"><span>Минуты</span><input class="input" id="banMinutes" type="number" min="0" max="525600" value="0"></label><label class="filter-field"><span>Часы</span><input class="input" id="banHours" type="number" min="0" max="8760" value="1"></label><label class="filter-field"><span>Дни</span><input class="input" id="banDays" type="number" min="0" max="3650" value="0"></label></div></section><section data-ban-panel="calendar" hidden><div class="ban-calendar-clock"><div class="ban-calendar"><div class="ban-cal-head"><button type="button" class="mini-button" data-cal-prev aria-label="Предыдущий месяц"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button><strong data-cal-label></strong><button type="button" class="mini-button" data-cal-next aria-label="Следующий месяц"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button></div>'+calendarWeekMarkup()+'<div class="ban-cal-grid" data-calendar-grid></div></div><div class="ban-clock-panel"><div class="ban-clock-mode" data-clock-active="hours"><button type="button" class="active" data-clock-mode="hours">Часы</button><button type="button" data-clock-mode="minutes">Минуты</button></div><div class="ban-clock" data-ban-clock><div class="ban-clock-numbers" data-clock-numbers></div><div class="ban-clock-hand hour-hand" data-clock-hand="hours"></div><div class="ban-clock-hand minute-hand" data-clock-hand="minutes"></div><div class="ban-clock-center"></div></div><div class="ban-clock-time" data-clock-time>12:00</div></div></div></section></div><div class="ban-summary" data-ban-summary>Будет рассчитано после выбора срока.</div><div class="form-row admin-ban-actions"><button class="button secondary" type="button" id="clearUserBan" '+(!banned?'hidden':'')+'>Снять блокировку</button><button class="button" type="button" id="saveUserChanges">Сохранить и заблокировать</button></div></div></details></div></section>';
      wait.innerHTML=translateHtml(wait.innerHTML);if(typeof window.BasaltRefreshDesktopModals==='function')window.BasaltRefreshDesktopModals();var modal=wait.querySelector('.admin-user-modal');if(isTargetAdmin)modal.classList.add('is-readonly-admin');
      if(!isTargetAdmin){var deleteZone=document.createElement('section');deleteZone.className='admin-user-delete-zone';deleteZone.innerHTML='<button type="button" class="button secondary full" id="startAdminUserDelete">Удалить пользователя</button><div class="admin-user-delete-confirm" hidden><button type="button" class="button danger full" id="confirmAdminUserDelete" disabled>Удалить (5)</button><button type="button" class="button secondary full" id="cancelAdminUserDelete">Отмена</button><p class="tiny muted">Удаление необратимо: будут удалены профиль, товары, прайс-листы, ключи и сохранённые данные пользователя.</p></div>';deleteZone.innerHTML=translateHtml(deleteZone.innerHTML);(modal.querySelector('.modal-content .modal-scroll-viewport')||modal.querySelector('.modal-content')).appendChild(deleteZone);var startDelete=deleteZone.querySelector('#startAdminUserDelete'),confirmDelete=deleteZone.querySelector('#confirmAdminUserDelete'),cancelDelete=deleteZone.querySelector('#cancelAdminUserDelete'),confirmBox=deleteZone.querySelector('.admin-user-delete-confirm'),deleteTimer=null,deleteLeft=5;function resetDeleteConfirm(){if(deleteTimer){clearInterval(deleteTimer);deleteTimer=null;}deleteLeft=5;startDelete.hidden=false;confirmBox.hidden=true;confirmDelete.disabled=true;confirmDelete.classList.remove('is-ready');confirmDelete.textContent=translateHtml('Удалить (5)');}startDelete.onclick=function(){startDelete.hidden=true;confirmBox.hidden=false;deleteLeft=5;confirmDelete.disabled=true;confirmDelete.classList.remove('is-ready');confirmDelete.textContent=translateHtml('Удалить (5)');deleteTimer=window.setInterval(function(){if(!wait.isConnected){clearInterval(deleteTimer);deleteTimer=null;return;}deleteLeft--;if(deleteLeft<=0){clearInterval(deleteTimer);deleteTimer=null;confirmDelete.disabled=false;confirmDelete.textContent=translateHtml('Удалить');confirmDelete.classList.add('is-ready');}else confirmDelete.textContent=translateHtml('Удалить (')+deleteLeft+')';},1000);};cancelDelete.onclick=resetDeleteConfirm;confirmDelete.onclick=function(){if(confirmDelete.disabled)return;confirmDelete.disabled=true;cancelDelete.disabled=true;confirmDelete.textContent=translateHtml('Удаление…');api('admin_delete_user',{user_id:Number(userId)}).then(function(){if(deleteTimer)clearInterval(deleteTimer);toast('Пользователь удалён');delete cache.admin_stats;delete cache.overview;wait.remove();renderScreen('admin');}).catch(function(err){cancelDelete.disabled=false;resetDeleteConfirm();toast(friendlyError(err));});};}
      bindSheetDrag(wait,modal);
      var assignKeyDrop=modal.querySelector('#adminAssignKey');if(assignKeyDrop){var assignKeyTrigger=assignKeyDrop.querySelector('.custom-select-trigger');assignKeyTrigger.onclick=function(event){event.preventDefault();event.stopPropagation();var opening=!assignKeyDrop.classList.contains('open');document.querySelectorAll('[data-select-key],[data-filter-select-key],[data-seller-select]').forEach(function(drop){if(drop!==assignKeyDrop){drop.classList.remove('open');var t=drop.querySelector('.custom-select-trigger');if(t)t.setAttribute('aria-expanded','false');}});assignKeyDrop.classList.toggle('open',opening);assignKeyTrigger.setAttribute('aria-expanded',opening?'true':'false');};assignKeyDrop.querySelectorAll('[data-value]').forEach(function(option){option.onclick=function(event){event.preventDefault();event.stopPropagation();var value=option.getAttribute('data-value')||'';assignKeyDrop.setAttribute('data-selected-value',value);assignKeyTrigger.querySelector('span').textContent=translateHtml(option.getAttribute('data-label')||'Выберите свободный ключ');assignKeyDrop.querySelectorAll('[data-value]').forEach(function(other){var active=other===option;other.classList.toggle('selected',active);other.setAttribute('aria-selected',active?'true':'false');var check=other.querySelector('.svg-icon');if(check)check.remove();if(active)other.insertAdjacentHTML('beforeend',iconSvg('check'));});assignKeyDrop.classList.remove('open');assignKeyTrigger.setAttribute('aria-expanded','false');};});}
      var assignKeyButton=modal.querySelector('#adminAssignKeyButton');if(assignKeyButton)assignKeyButton.onclick=function(){var keyId=Number(modal.querySelector('#adminAssignKey').getAttribute('data-selected-value')||0);if(!keyId){toast('Выберите свободный ключ');return;}assignKeyButton.disabled=true;api('admin_change_user_key',{user_id:Number(userId),key_id:keyId}).then(function(){var message=translateHtml('Подписка активирована');if(sub&&sub.active)message+='\n\n'+translateHtml('Предыдущая активная подписка деактивирована.');window.alert(message);delete cache.admin_stats;wait.remove();openAdminUserModal(userId);}).catch(function(err){assignKeyButton.disabled=false;window.alert(translateHtml('Подписка не активирована')+'\n\n'+friendlyError(err));});};
      var extendButton=modal.querySelector('#adminExtendSubscription');
      if(extendButton){
        var extendUnit='days';var extendAmount=modal.querySelector('#adminExtendAmount');var extendSummary=modal.querySelector('#adminExtendSummary');
        function parseUntil(value){var dt=new Date(String(value||'').replace(' ','T'));return isNaN(dt.getTime())?new Date():dt;}
        function extendedDate(){var dt=parseUntil(sub&&sub.available_until);var amount=Math.max(1,Number(extendAmount.value||1));if(extendUnit==='hours')dt.setHours(dt.getHours()+amount);else if(extendUnit==='months')dt.setMonth(dt.getMonth()+amount);else dt.setDate(dt.getDate()+amount);return {date:dt,amount:amount};}
        function updateExtensionSummary(){var result=extendedDate();var word=extendUnit==='hours'?'ч.':(extendUnit==='months'?'мес.':'дн.');extendSummary.textContent=translateHtml('Будет добавлено: ')+result.amount+' '+translateHtml(word)+'. '+translateHtml('Новый срок: ')+result.date.toLocaleString(localeTag(),{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})+'.';}
        extendAmount.addEventListener('input',updateExtensionSummary);
        modal.querySelectorAll('[data-extension-unit-value]').forEach(function(b){b.onclick=function(){extendUnit=b.getAttribute('data-extension-unit-value')||'days';var units=modal.querySelector('.admin-sub-extension-units');if(units)units.setAttribute('data-extension-unit',extendUnit);modal.querySelectorAll('[data-extension-unit-value]').forEach(function(other){other.classList.toggle('active',other===b);});extendAmount.max=extendUnit==='hours'?'8760':(extendUnit==='months'?'120':'3650');updateExtensionSummary();};});
        extendButton.onclick=function(){var amount=Math.floor(Number(extendAmount.value||0));if(!Number.isFinite(amount)||amount<1){toast('Укажите срок продления больше нуля');return;}extendButton.disabled=true;api('admin_extend_user_subscription',{user_id:Number(userId),amount:amount,unit:extendUnit}).then(function(){toast('Срок подписки продлён');delete cache.admin_stats;wait.remove();openAdminUserModal(userId);}).catch(function(err){extendButton.disabled=false;toast(friendlyError(err));});};
        updateExtensionSummary();
      }
      modal.querySelectorAll('[data-admin-download-file]').forEach(function(button){button.onclick=function(){var fileId=Number(button.getAttribute('data-admin-download-file'));if(fileId>0)requestFileDownload(button,'file',fileId,Number(userId),'price-list.xlsx');};});
      var downloadAllAdmin=modal.querySelector('[data-admin-download-all]');if(downloadAllAdmin)downloadAllAdmin.onclick=function(){requestFileDownload(downloadAllAdmin,'all',0,Number(userId),'basalt-price-lists.zip');};
      modal.querySelectorAll('[data-admin-delete-file]').forEach(function(button){bindTimedDelete(button,function(){var fileId=Number(button.getAttribute('data-admin-delete-file'));return api('delete_file',{file_id:fileId,user_id:Number(userId)}).then(function(){toast('Прайс-лист удалён');delete cache.admin_stats;wait.remove();return refreshOverviewSignals().then(function(){openAdminUserModal(userId);});});});});
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
      function updateSummary(){var summary=modal.querySelector('[data-ban-summary]'),permanent=modal.querySelector('#banPermanent').checked;if(permanent){summary.textContent=translateHtml('Бессрочно — дата автоматической разблокировки не назначается.');return;}if(banMode==='calendar'){var d=selectedUntil();if(!d){summary.textContent=translateHtml('Выберите дату в календаре и время разблокировки.');return;}var seconds=Math.floor((d.getTime()-Date.now())/1000);summary.textContent=seconds>0?translateHtml('Блокировка на ')+translateHtml(durationText(seconds))+'. '+translateHtml('Разблокировка: ')+d.toLocaleString(localeTag(),{dateStyle:'medium',timeStyle:'short'})+'.':translateHtml('Выбранное время уже прошло — задайте будущее время.');}else{var sec=Math.max(0,Number(modal.querySelector('#banMinutes').value||0)*60+Number(modal.querySelector('#banHours').value||0)*3600+Number(modal.querySelector('#banDays').value||0)*86400);summary.textContent=sec>=60?translateHtml('Блокировка на ')+translateHtml(durationText(sec))+'. '+translateHtml('Разблокировка: ')+new Date(Date.now()+sec*1000).toLocaleString(localeTag(),{dateStyle:'medium',timeStyle:'short'})+'.':translateHtml('Укажите длительность не менее одной минуты.');}}
      function renderCalendar(){var y=calDate.getFullYear(),m=calDate.getMonth();modal.querySelector('[data-cal-label]').textContent=calDate.toLocaleDateString(localeTag(),{month:'long',year:'numeric'});var first=new Date(y,m,1),offset=(first.getDay()+6)%7,total=new Date(y,m+1,0).getDate(),grid='';for(var i=0;i<offset;i++)grid+='<span class="ban-cal-blank"></span>';for(var day=1;day<=total;day++){var active=selectedDate&&selectedDate.getFullYear()===y&&selectedDate.getMonth()===m&&selectedDate.getDate()===day;var today=new Date();var isPast=new Date(y,m,day,23,59)<new Date(today.getFullYear(),today.getMonth(),today.getDate());grid+='<button type="button" data-cal-day="'+day+'" class="ban-cal-day '+(active?'selected ':'')+(isPast?'past':'')+'" '+(isPast?'disabled':'')+'>'+day+'</button>';}modal.querySelector('[data-calendar-grid]').innerHTML=grid;modal.querySelectorAll('[data-cal-day]').forEach(function(b){b.onclick=function(){var day=Number(b.getAttribute('data-cal-day'));selectedDate=new Date(y,m,day);modal.querySelector('.ban-calendar-clock').classList.remove('has-date');modal.querySelector('.ban-clock-panel').hidden=false;renderCalendar();renderClock();updateSummary();};});}
      function renderClock(){var face=modal.querySelector('[data-ban-clock]'),numbers=modal.querySelector('[data-clock-numbers]');numbers.innerHTML='';var count=12;for(var i=0;i<count;i++){var val=clockMode==='hours'?(i*2):(i*5);var angle=(i/count)*Math.PI*2-Math.PI/2;var x=50+38*Math.cos(angle),y=50+38*Math.sin(angle);var span=document.createElement('button');span.type='button';span.className='ban-clock-number';span.style.left=x+'%';span.style.top=y+'%';span.textContent=String(val).padStart(2,'0');span.setAttribute('data-clock-value',String(val));span.addEventListener('pointerdown',function(event){event.stopPropagation();});span.onclick=function(event){event.stopPropagation();applyClockValue(Number(this.getAttribute('data-clock-value')));};numbers.appendChild(span);}var hourAngle=((hours%24)/24)*360,minuteAngle=(minutes/60)*360;modal.querySelector('[data-clock-hand="hours"]').style.transform='translateX(-50%) rotate('+hourAngle+'deg)';modal.querySelector('[data-clock-hand="minutes"]').style.transform='translateX(-50%) rotate('+minuteAngle+'deg)';modal.querySelector('[data-clock-time]').textContent=String(hours).padStart(2,'0')+':'+String(minutes).padStart(2,'0');}
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
      :(ever?'Срок доступа закончился. Введите новый ключ на сайте, чтобы продлить подписку.':'Для начала работы введите ключ активации на сайте.');
    var buttonLabel=active&&state.role==='none'?'Открыть чат с ботом':(ever?'Продлить подписку в Telegram':'Купить подписку в Telegram');
    var href=botUrl('subscribe')||('https://t.me/'+encodeURIComponent(botUsername));
    var siteKeyActivation=true;
    var html=heading('ДОСТУП К BASALT','Подписка требуется','Каталог и остальные разделы станут доступны после активации подписки.');
    html+='<section class="empty global-server-error subscription-required-page"><div class="symbol">'+iconSvg('subscription')+'</div><strong>'+esc(title)+'</strong><p class="tiny">'+esc(siteKeyActivation?'Активируйте ключ на сайте, чтобы открыть каталог и остальные разделы.':message)+'</p>'+'<button type="button" class="button full" id="openSiteKeyActivation">Перейти к активации</button></section>';
    hideScreenLoading();app.innerHTML=translateHtml(html);app.classList.remove('screen-loading');app.style.minHeight='';var siteActivateButton=document.getElementById('openSiteKeyActivation');if(siteActivateButton)siteActivateButton.onclick=openSiteKeyActivationModal;
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
    html+='<div class="card virtual-profile-banner"><div class="tiny muted">ВИРТУАЛЬНЫЙ АККАУНТ</div><strong>'+esc(profileKey)+'</strong><span class="role-badge '+esc(role)+'">'+esc(String(role||'none').toUpperCase())+'</span><span class="status-label"><i class="dot"></i> Только просмотр</span></div>';

    if(screen==='prices'){
      html+='<div class="row virtual-list-heading"><div><div class="card-title">Обработанные прайс-листы</div><div class="tiny muted">Последние файлы · демонстрационные данные</div></div><span class="status-label">Всего: 8</span></div><div class="file-list virtual-file-list">';
      [['dior-price.xlsx','Dior · 248 позиций','Обработан сегодня, 12:42'],['chanel_catalog.xlsx','Chanel · 186 позиций','Обработан сегодня, 10:18'],['ysl_october.xlsx','Yves Saint Laurent · 312 позиций','Обработан вчера, 18:06'],['versace-list.csv','Versace · 94 позиции','Обработан вчера, 15:31']].forEach(function(f,i){html+='<div class="file-card"><div class="file-icon">XLS</div><div class="file-info"><div class="file-name">'+esc(f[0])+'</div><div class="file-meta">'+esc(f[1])+'</div><div class="file-meta">'+esc(f[2])+'</div></div><span class="status-label">Готов</span></div>';});
      html+='</div><section class="empty virtual-placeholder"><div class="symbol">'+iconSvg('file')+'</div><strong>Тут будут обработанные прайс-листы</strong><p class="tiny">Список выше показан для демонстрации внешнего вида интерфейса.</p></section>';
    }else if(screen==='search'||screen==='best'){
      html+='<div class="search-toolbar"><div class="search-box"><span>'+iconSvg('search')+'</span><input placeholder="Например, Dior Sauvage или 100 ml" disabled></div><button type="button" class="button secondary filter-launch" disabled>'+iconSvg('filter')+'<span>Фильтры</span><b>2</b></button></div><div class="filters"><span class="filter-chip active">Все товары</span><span class="filter-chip">Парфюмерная вода</span><span class="filter-chip">100 мл</span><span class="filter-chip">В наличии</span></div><div class="result-bar"><div class="tiny muted">1 284 позиции в каталоге</div><span class="tiny muted">Сортировка: сначала дешевле</span></div><div class="product-results buyer-product-results">';
      [['Dior Sauvage Eau de Toilette','Мужской · Туалетная вода · 100 мл','86,00 €','Dior'],['Bleu de Chanel Eau de Parfum','Мужской · Парфюмерная вода · 100 мл','113,00 €','Chanel'],['Y Eau de Parfum','Мужской · Парфюмерная вода · 100 мл','94,00 €','Yves Saint Laurent'],['Versace Dylan Blue','Мужской · Туалетная вода · 100 мл','59,00 €','Versace']].forEach(function(prod,i){html+='<article class="product-card buyer-product-card"><div class="product-main"><div class="product-name">'+esc(prod[0])+'</div><div class="product-sub">'+esc(prod[1])+'</div><div class="product-tag"><span class="tag">'+esc(prod[3])+'</span><span class="tag">В наличии</span></div></div><div class="product-price-wrap"><div class="product-price">'+esc(prod[2])+'</div><div class="tiny muted">лучшая цена</div></div></article>';});
      html+='</div>';
    }else if(screen==='subscription'){
      html+='<section class="subscription-card"><div class="row"><span class="subscription-plan">BASALT · PREMIUM ACCESS</span><span class="status-label">Активна</span></div><div class="subscription-status"><span class="status-dot"></span> Все функции доступны</div><div class="subscription-time">6 дней</div><div class="muted tiny">Действует до 21 октября 2026</div><div class="progress" aria-label="Осталось 6 из 7 дней"><span style="width:85.7% !important;--subscription-progress:85.7%;background:#fff;display:block;min-width:2px"></span></div><div class="row tiny muted"><span>Ключ: BP-EXAMPLE</span><span>Доступ открыт</span></div></section>';
      html+='<div class="section-head"><h2>Что включено</h2></div><div class="card"><div class="setting-row"><div class="setting-icon">'+iconSvg('file')+'</div><div class="setting-copy"><strong>Каталог прайс-листов</strong><small>Обработка файлов и единый список товаров</small></div><span class="feature-check">'+iconSvg('check')+'</span></div><div class="divider"></div><div class="setting-row"><div class="setting-icon">'+iconSvg('search')+'</div><div class="setting-copy"><strong>Поиск и сравнение цен</strong><small>Фильтры по бренду, типу и объёму</small></div><span class="feature-check">'+iconSvg('check')+'</span></div><div class="divider"></div><div class="setting-row"><div class="setting-icon">'+iconSvg('bell')+'</div><div class="setting-copy"><strong>Уведомления о сроке</strong><small>Напоминания до окончания подписки</small></div><span class="feature-check">'+iconSvg('check')+'</span></div></div><div class="card"><div class="card-title">Продлить доступ</div><p class="tiny muted">Введите ключ активации на сайте, чтобы продлить подписку.</p><button type="button" class="button full" disabled>Ввести ключ активации '+iconSvg('key')+'</button></div>';
    }else if(screen==='settings'){
      var roleLabel=String(role||'none').toUpperCase();
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
      html+='<div class="card"><div class="row"><div><div class="card-title">Связаться с разработчиком</div><div class="tiny muted">Вопросы, идеи и сообщения об ошибках</div></div><div class="setting-icon">'+iconSvg('arrow')+'</div></div><div class="divider"></div><button class="button full" disabled>Написать разработчику '+iconSvg('arrow')+'</button></div><div class="section-head"><h2>Частые вопросы</h2></div><div class="card"><div class="faq-item"><div class="faq-q">Как загрузить прайс-лист? '+iconSvg('chevron')+'</div><div class="faq-a">Откройте страницу «Прайсы», выберите один или несколько Excel/CSV-файлов и нажмите «Загрузить и обработать».</div></div><div class="faq-item"><div class="faq-q">Почему часть строк требует проверки? '+iconSvg('chevron')+'</div><div class="faq-a">Неоднозначные названия и цены можно проверить вручную.</div></div><div class="faq-item"><div class="faq-q">Сколько времени обрабатывается один файл?</div><div class="faq-a">Обычно обработка одного файла занимает примерно 3–5 минут. Время зависит от размера прайс-листа и количества строк.</div></div><div class="faq-item"><div class="faq-q">Как обрабатываются конфликтные файлы?</div><div class="faq-a">При совпадении система предложит выбрать «Отмена» или «Замена». Новая версия заменит старую только после успешной обработки.</div></div></div>';
    }else{
      html+='<section class="section-head"><h2>Сводка каталога</h2>'+(role==='buyer'?'<span class="text-link">Подписка '+iconSvg('arrow')+'</span>':'<span class="tiny muted">Демо-данные</span>')+'</section>';
      if(role==='buyer'){
        html+='<div class="stats-grid home-catalog-stats buyer-stats"><div class="stat-card"><div class="stat-icon">'+iconSvg('subscription')+'</div><div class="stat-value">1 284</div><div class="stat-label">Товаров в каталоге</div></div><div class="stat-card"><div class="stat-icon">'+iconSvg('bell')+'</div><div class="stat-value">2</div><div class="stat-label">Новых уведомлений</div></div><div class="stat-card"><div class="stat-icon">'+iconSvg('clock')+'</div><div class="stat-value">6</div><div class="stat-label">Дней осталось</div></div><div class="stat-card favorites-stat-card"><div class="stat-icon">'+favoriteStarSvg(false)+'</div><div class="stat-value">12</div><div class="stat-label">Избранное</div></div></div><div class="section-head"><h2>Быстрый доступ</h2></div><div class="action-grid buyer-action-grid"><div class="action-card buyer-search-wide"><span class="symbol">'+iconSvg('search')+'</span><span><strong>Поиск товаров</strong><small>Фильтры, бренды и сравнение цен</small></span></div><div class="action-card"><span class="symbol">'+iconSvg('bell')+'</span><span><strong>Уведомления</strong><small>Новости и статус подписки</small></span></div><div class="action-card"><span class="symbol">'+iconSvg('arrow')+'</span><span><strong>Поддержка</strong><small>FAQ и обратная связь</small></span></div></div>';
      }else if(role==='seller'){
        html+='<div class="stats-grid home-catalog-stats"><div class="stat-card"><div class="stat-icon">'+iconSvg('file')+'</div><div class="stat-value">8</div><div class="stat-label">Прайс-листов</div></div><div class="stat-card"><div class="stat-icon">'+iconSvg('subscription')+'</div><div class="stat-value">2 440</div><div class="stat-label">Позиций каталога</div></div><div class="stat-card"><div class="stat-icon">'+iconSvg('bell')+'</div><div class="stat-value">3</div><div class="stat-label">Новых уведомлений</div></div><div class="stat-card"><div class="stat-icon">'+iconSvg('clock')+'</div><div class="stat-value">6</div><div class="stat-label">Дней осталось</div></div></div><div class="section-head"><h2>Быстрый доступ</h2></div><div class="action-grid"><div class="action-card"><span class="symbol">'+iconSvg('file')+'</span><span><strong>Прайс-листы</strong><small>Файлы и обработка</small></span></div><div class="action-card"><span class="symbol">'+iconSvg('search')+'</span><span><strong>Поиск товаров</strong><small>Поиск по общему каталогу</small></span></div><div class="action-card"><span class="symbol">'+iconSvg('bell')+'</span><span><strong>Уведомления</strong><small>Новости и статусы</small></span></div></div>';
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
    overlay.innerHTML='<section class="filter-modal modal-filter favorites-modal" role="dialog" aria-modal="true" aria-labelledby="virtualFavoritesTitle"><div class="modal-grab"><span></span></div><div class="modal-content"><div class="modal-head"><div><p class="eyebrow">ВИЗУАЛЬНЫЙ РЕЖИМ</p><h2 id="virtualFavoritesTitle">Избранное</h2></div></div><section class="empty"><div class="symbol">'+favoriteStarSvg(false)+'</div><strong>Тут будут избранные товары</strong><p class="tiny">Список специально пуст в профиле test_buyer.</p></section></div></section>';
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
    revealUiChrome();
    app.innerHTML='<section class="system-lock"><div class="system-lock-icon">'+iconSvg(isBan?'lock':'wrench')+'</div><p class="eyebrow">'+(isBan?'ДОСТУП ОГРАНИЧЕН':'BASALT · ТЕХНИЧЕСКИЕ РАБОТЫ')+'</p><h1>'+esc(title)+'</h1><p class="system-lock-message">'+esc(message)+'</p><p class="tiny muted system-lock-until">'+(until?esc((isBan?'Блокировка до: ':'Ожидаемое завершение: ')+String(until)):(isBan?'Блокировка бессрочная':'Срок окончания не указан'))+'</p><button type="button" class="button secondary system-lock-retry" id="systemLockRetry">Проверить снова</button></section>';
    var retry=document.getElementById('systemLockRetry');if(retry)retry.onclick=function(){window.location.reload();};
  }
  function restoreSystemLockShell(){
    document.body.classList.remove('system-lock-mode');app.classList.remove('system-lock-view');
    var topbar=document.querySelector('.topbar');if(topbar)topbar.hidden=false;
    var notifyButton=document.getElementById('notificationsButton');if(notifyButton)notifyButton.hidden=false;
    var bottomNav=document.getElementById('bottomNav');if(bottomNav){configureRoleNavigation();bottomNav.hidden=!!(subscriptionGateState&&!isAdmin);}
    var previewBadge=document.getElementById('previewBadge');if(previewBadge)previewBadge.hidden=false;
  }
  function handleApiGuardError(error){
    if(!error||!error.code)return;
    var data=error.apiData||{};
    if(error.code==='session_inactive'){
      bpApplySessionSync({enabled:true,active:false,owner_platform:data.owner_platform||null});
    }else if(error.code==='maintenance_mode'){
      renderSystemLock('maintenance',{title:data.title,message:data.message,until:data.until});
    }else if(error.code==='user_banned'){
      renderSystemLock('ban',{reason:data.reason||error.message,until:data.banned_until});
    }
  }
  function paintUnreadBadge(){
    var unread=!!(overview&&Number(overview.unread_count||0)>0);
    var mobileDot=document.getElementById('unreadDot'),desktopDot=document.getElementById('desktopUnreadDot');
    if(mobileDot)mobileDot.classList.toggle('on',unread);
    if(desktopDot)desktopDot.classList.toggle('on',unread);
  }
  function applyOverviewGuardState(data){
    if(!data)return false;
    overview=data;profile=data.profile||profile;
    paintUnreadBadge();
    var p=data.profile||{},sys=data.system||{};
    if(p.ban_active){renderSystemLock('ban',{reason:p.ban_reason,until:p.banned_until});return true;}
    if(sys.maintenance_mode&&!data.is_admin){renderSystemLock('maintenance',{title:sys.maintenance_title,message:sys.maintenance_message,until:sys.maintenance_until});return true;}
    if(document.body.classList.contains('system-lock-mode'))restoreSystemLockShell();
    return false;
  }
  function isApiGuardError(error){return !!(error&&['session_inactive','maintenance_mode','user_banned'].indexOf(error.code)!==-1);}
  function checkSystemLock(prefetchedOverview){
    var request=prefetchedOverview?Promise.resolve(prefetchedOverview):api('overview');
    return request.then(function(data){return applyOverviewGuardState(data);}).catch(function(error){if(!isApiGuardError(error))renderGlobalLoadError(error);return true;});
  }
  function refreshOverviewSignals(){
    if(previewModeActive||(!initData&&!browserSessionActive))return Promise.resolve(overview);
    return api('overview').then(function(data){applyOverviewGuardState(data);return data;}).catch(function(error){handleApiGuardError(error);return overview;});
  }
  function refreshUnreadBadge(){paintUnreadBadge();}
  function trackPriceFileTransitions(files){
    if(!Array.isArray(files))return;
    var next=Object.create(null),terminalTransition=false;
    files.forEach(function(file){
      var id=String(file.id||file.price_list_id||'');if(!id)return;
      var status=String(file.status||'').toLowerCase(),previous=priceFileStatusSnapshot[id];
      next[id]=status;
      if((priceFileStatusInitialized&&((previous&&previous!==status&&/^(pending|processing)$/.test(previous)&&/^(ready|error|failed)$/.test(status))||(!previous&&/^(ready|error|failed)$/.test(status))))||(priceFileStatusExpectedIds[id]&&/^(ready|error|failed)$/.test(status))){terminalTransition=true;delete priceFileStatusExpectedIds[id];}
    });
    priceFileStatusSnapshot=next;priceFileStatusInitialized=true;
    if(terminalTransition)refreshOverviewSignals();
  }
  function renderScreen(screen,prefetchedOverview){
    updateLocalizedDocumentTitle(screen);
    syncTelegramBackButton(screen);
    updateDesktopBreadcrumb(screen);
    app.classList.toggle('browser-admin-grid',!!(browserSessionActive && !initData && screen==='admin'));
    app.classList.toggle('browser-settings-layout',!!(browserSessionActive && !initData && screen==='settings'));
    if(previewModeActive&&previewRole){renderVirtualScreen(screen);return;}
    if(globalLoadFailure){hideScreenLoading();renderGlobalLoadError(globalLoadFailure);return;}
    app.classList.add('screen-loading');
    app.style.minHeight='0';
    showScreenLoading();
    if(document.documentElement.classList.contains('ui-boot-pending'))revealUiChrome();
    checkSystemLock(prefetchedOverview).then(function(locked){
      if(locked){hideScreenLoading();app.classList.remove('screen-loading');app.style.minHeight='';return;}
      restoreSystemLockShell();
      if(subscriptionGateState&&!isAdmin){hideScreenLoading();app.classList.remove('screen-loading');app.style.minHeight='';renderSubscriptionGate(subscriptionGateState);revealUiChrome();return;}
      if(globalLoadFailure){hideScreenLoading();app.classList.remove('screen-loading');renderGlobalLoadError(globalLoadFailure);return;}
      var task;
      if(screen==='home')task=renderHome();
      else if(screen==='prices')task=renderPrices();
      else if(screen==='subscription')task=renderSubscription();
      else if(screen==='settings')task=renderSettings();
      else if(screen==='notifications')task=renderNotifications();
      else if(screen==='search')task=renderSearch('products');
      else if(screen==='best')task=renderSearch('best');
      else if(screen==='support')task=renderSupport();
      else if(screen==='admin')task=renderAdmin();
      else task=renderHome();
      Promise.resolve(task).then(function(){
        hideScreenLoading();app.classList.remove('screen-loading');app.style.minHeight='';
        app.classList.remove('screen-enter');void app.offsetWidth;app.classList.add('screen-enter');
        if(activeScreen===screen)resetPageScroll();
        revealUiChrome();
      }).catch(function(error){hideScreenLoading();app.classList.remove('screen-loading');app.style.minHeight='';if(!isApiGuardError(error))renderGlobalLoadError(error);});
    }).catch(function(error){hideScreenLoading();app.classList.remove('screen-loading');app.style.minHeight='';if(!isApiGuardError(error))renderGlobalLoadError(error);});
  }
  document.addEventListener('click',function(e){if(!e.target.closest('[data-select-key],[data-filter-select-key],[data-seller-select]'))document.querySelectorAll('[data-select-key],[data-filter-select-key],[data-seller-select]').forEach(function(drop){drop.classList.remove('open');var trigger=drop.querySelector('.custom-select-trigger');if(trigger)trigger.setAttribute('aria-expanded','false');});});
  // Telegram buttons remain ordinary anchor links. Avoid intercepting clicks: WebView clients
  // differ in how openTelegramLink handles user/profile links and may swallow the navigation.
  ['bottomNav','desktopSidebar','desktopCompactNav'].forEach(function(id){var root=document.getElementById(id);if(root)root.addEventListener('click',function(e){var b=e.target.closest('button[data-screen]');if(b&&!b.hidden)nav(b.getAttribute('data-screen'));});});
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
  var markAllReadButton=document.getElementById('markAllReadButton');if(markAllReadButton)markAllReadButton.onclick=function(){if(markAllReadButton.disabled)return;markAllReadButton.disabled=true;api('mark_all_read',{}).then(function(result){delete cache.notifications;delete cache.overview;var dot=document.getElementById('unreadDot');if(dot)dot.classList.remove('on');var sideDot=document.getElementById('desktopUnreadDot');if(sideDot)sideDot.classList.remove('on');toast('Прочитано уведомлений: '+Number(result.updated||0));renderScreen('notifications');}).catch(function(error){markAllReadButton.disabled=false;toast(error);});};
  document.addEventListener('contextmenu',function(e){if(e.target&&e.target.closest&&e.target.closest('img,canvas'))e.preventDefault();});
  if(window.BasaltEffects&&window.BasaltEffects.initOrbField)window.BasaltEffects.initOrbField();
  // Telegram destinations remain normal anchors (target=_blank); this avoids WebView interception issues.
  var bpSessionSync = { started:false, clientId:'', platform:initData?'telegram_webapp':(browserMobileMode?'mobile_browser':'desktop'), overlay:null, active:true, enabled:true, busy:false, cleared:false, reloading:false };
  function bpSessionClientId(){
    var key='basalt-session-sync-client-v1';
    try{var id=sessionStorage.getItem(key);if(id&&/^[a-f0-9]{24,64}$/i.test(id))return id;var bytes=new Uint8Array(16);if(window.crypto&&window.crypto.getRandomValues)window.crypto.getRandomValues(bytes);else for(var i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);id=Array.prototype.map.call(bytes,function(x){return ('0'+x.toString(16)).slice(-2);}).join('');sessionStorage.setItem(key,id);return id;}catch(e){return (String(Date.now())+Math.random().toString(16).slice(2)).replace(/[^a-f0-9]/gi,'').slice(0,32);}
  }
  function bpSessionOverlay(){
    if(bpSessionSync.overlay&&bpSessionSync.overlay.isConnected)return bpSessionSync.overlay;
    var node=document.createElement('div');node.className='bp-session-sync-overlay';node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');
    node.innerHTML='<section class="bp-session-sync-card"><div class="bp-session-sync-eyebrow">BASALT PERFUME</div><h2>'+esc(localizeUiText('Сайт открыт в другой сессии','The site is active in another session','Сайт басқа сессияда белсенді'))+'</h2><p>'+esc(localizeUiText('Сейчас вы работаете в другой версии сайта. Чтобы продолжить здесь, переключите активную сессию.','You are currently active in another version of the site. Switch the active session to continue here.','Қазір сайттың басқа нұсқасында жұмыс істеп жатырсыз. Мұнда жалғастыру үшін белсенді сессияны ауыстырыңыз.'))+'</p><button type="button" class="button bp-session-sync-continue">'+esc(localizeUiText('Продолжить здесь','Continue here','Осы жерде жалғастыру'))+'</button></section>';
    node.querySelector('button').addEventListener('click',function(){if(bpSessionSync.busy)return;bpSessionSync.busy=true;var b=node.querySelector('button');b.disabled=true;b.textContent=localizeUiText('Переключаем…','Switching…','Ауыстыру…');api('session_sync',{mode:'claim',client_id:bpSessionSync.clientId,platform:bpSessionSync.platform}).then(function(r){bpApplySessionSync(r);if(r&&r.active!==false){bpReloadSessionInterface();}}).catch(function(e){toast(friendlyError(e));}).finally(function(){bpSessionSync.busy=false;if(b.isConnected){b.disabled=false;b.textContent=localizeUiText('Продолжить здесь','Continue here','Осы жерде жалғастыру');}});});
    document.body.appendChild(node);bpSessionSync.overlay=node;return node;
  }
  function bpClearSessionInterface(){
    if(bpSessionSync.cleared)return;bpSessionSync.cleared=true;
    // Remove rendered application blocks completely. The takeover page is kept outside
    // .app-shell, so the user sees only the handover card until a fresh document boot.
    var shell=document.querySelector('.app-shell');if(shell)shell.replaceChildren();
    document.querySelectorAll('#orbCanvas,.boot-blur-overlay,.modal-backdrop,.modal-root,.toast,.toast-container,[role="alert"]').forEach(function(node){if(node!==bpSessionSync.overlay&&node.isConnected)node.remove();});
  }
  function bpReloadSessionInterface(){
    if(bpSessionSync.reloading)return;bpSessionSync.reloading=true;
    // All stylesheet URLs are version-bumped in this patch. A full document reload
    // fetches the new CSS set and rebuilds every shell/component from its clean markup.
    window.location.reload();
  }
  function bpApplySessionSync(result){
    if(!result)return;var wasInactive=bpSessionSync.enabled&&!bpSessionSync.active;
    bpSessionSync.enabled=result.enabled!==false;bpSessionSync.active=!bpSessionSync.enabled||result.active!==false;
    var inactive=bpSessionSync.enabled&&!bpSessionSync.active;
    document.body.classList.toggle('bp-session-inactive',inactive);
    if(inactive){bpSessionOverlay();bpClearSessionInterface();}
    else if(bpSessionSync.overlay&&bpSessionSync.overlay.isConnected){bpSessionSync.overlay.remove();bpSessionSync.overlay=null;}
    if(!inactive&&bpSessionSync.cleared&&!bpSessionSync.reloading)bpReloadSessionInterface();
  }
  function bpSessionPulse(mode){
    if(bpSessionSync.busy||previewModeActive||(!initData&&!browserSessionActive))return Promise.resolve();
    bpSessionSync.busy=true;
    return api('session_sync',{mode:mode||'status',client_id:bpSessionSync.clientId,platform:bpSessionSync.platform}).then(bpApplySessionSync).catch(function(error){handleApiGuardError(error);}).finally(function(){bpSessionSync.busy=false;});
  }
  function startBpSessionSync(){
    if(bpSessionSync.started||previewModeActive)return;
    bpSessionSync.started=true;
    bpSessionSync.clientId=bpSessionClientId();
    // All API calls from this point carry the session identity in their payload.
    // The first overview request itself claims/refreshes the session in the API router.
    window.BasaltSessionContext={client_id:bpSessionSync.clientId,platform:bpSessionSync.platform};
  }
  function installPopupSessionChecks(){
    if(typeof MutationObserver==='undefined'||!document.body)return;
    var observer=new MutationObserver(function(records){
      var opened=false;
      records.forEach(function(record){record.addedNodes.forEach(function(node){
        if(!node||node.nodeType!==1)return;
        if((node.matches&&node.matches('.modal-backdrop'))||(node.querySelector&&node.querySelector('.modal-backdrop')))opened=true;
      });});
      if(!opened||previewModeActive||(!initData&&!browserSessionActive)||!bpSessionSync.started)return;
      if(bpModalSessionCheckTimer)window.clearTimeout(bpModalSessionCheckTimer);
      bpModalSessionCheckTimer=window.setTimeout(function(){
        bpModalSessionCheckTimer=null;
        // A modal opened as the immediate result of an API-backed action already
        // passed the same guard. Only send a status action for purely local dialogs.
        if(Date.now()-bpLastGuardedApiRequestAt<900)return;
        bpSessionPulse('status');
      },420);
    });
    observer.observe(document.body,{childList:true,subtree:true});
  }

  installPopupSessionChecks();


  function initDesktopSidebarToggle(){
    var toggle=document.getElementById('desktopSidebarToggle');
    if(!toggle||!document.body.classList.contains('desktop-shell'))return;
    var key='basalt-desktop-sidebar-collapsed-v1',saved=false;
    try{saved=localStorage.getItem(key)==='1';}catch(e){}
    function apply(){
      var collapsed=window.innerWidth>1120&&saved;
      document.body.classList.toggle('desktop-sidebar-collapsed',collapsed);
      toggle.setAttribute('aria-expanded',collapsed?'false':'true');
      toggle.setAttribute('aria-label',collapsed?'Развернуть меню':'Свернуть меню');
      toggle.setAttribute('title',collapsed?'Развернуть меню':'Свернуть меню');
    }
    toggle.addEventListener('click',function(){saved=!document.body.classList.contains('desktop-sidebar-collapsed');try{localStorage.setItem(key,saved?'1':'0');}catch(e){}apply();});
    window.addEventListener('resize',apply,{passive:true});
    apply();
  }
  initDesktopSidebarToggle();

  function bootstrapAuthenticatedApp(){
    browserSessionActive=!initData;
    document.documentElement.classList.remove('external-open-pending');
    document.body.classList.remove('external-open');
    applyBodyUiModeClass();
    document.body.classList.toggle('browser-mode',!!browserSessionActive);
    var shell=document.querySelector('.app-shell');if(shell)shell.hidden=false;
    var topbar=document.querySelector('.topbar');if(topbar)topbar.hidden=false;
    var bottomNav=document.getElementById('bottomNav');if(bottomNav)bottomNav.hidden=true;
    var previewBadge=document.getElementById('previewBadge');if(previewBadge)previewBadge.hidden=true;
    startBpSessionSync();
    api('overview').then(function(o){
      overview=o;profile=o.profile;adoptProfileAppearance(profile);isAdmin=!!o.is_admin;currentRole=o.role||o.profile.role||(isAdmin?'admin':'none');currentPriceMultiplier=Number(o.profile.price_multiplier||1);botUsername=o.bot_username||botUsername;configureRoleNavigation();
      if(profile&&profile.ban_active){renderSystemLock('ban',{reason:profile.ban_reason,until:profile.banned_until});return null;}
      if(o.system&&o.system.maintenance_mode&&!isAdmin){renderSystemLock('maintenance',{title:o.system.maintenance_title,message:o.system.maintenance_message,until:o.system.maintenance_until});return null;}
      // One non-blocking avatar-cache attempt is made for every authenticated surface.
      // Keep the original Telegram photo_url in the profile and retain the local cache URL in memory.
      var avatarPromise=api('cache_avatar',{refresh:1}).then(function(result){
        if(result&&result.photo_url)updateCurrentUserAvatar(result.photo_url);
        return result||null;
      }).catch(function(error){
        console.warn('Telegram avatar cache failed; retaining the validated Telegram source/current cache.',error&&error.code||'avatar_cache_failed');
        return null;
      });
      if(previewMode&&!o.is_admin)throw new Error('admin_required');
      if(!isAdmin&&(currentRole==='none'||!o.subscription||!o.subscription.active)){
        subscriptionGateState={role:currentRole,subscription:o.subscription||null,hasEverActivated:!!o.has_ever_activated_subscription,browserFeatures:o.browser_features||{}};
        renderSubscriptionGate(subscriptionGateState);revealUiChrome();return null;
      }
      subscriptionGateState=null;
      // Transition from the full-document boot veil to a loader limited to the content workspace.
      // This must happen before cache_avatar/settings are pending, not after both have completed.
      showScreenLoading();
      restoreSystemLockShell();
      revealUiChrome();
      return Promise.all([avatarPromise,api('settings')]).then(function(results){
        var userSettings=results[1];
        settings=userSettings||settings;savedSettings=Object.assign({},settings);applyTheme();
        if(previewMode&&isAdmin){hideScreenLoading();renderPreviewRolePicker();return null;}
        // renderScreen reuses the visible overlay and keeps it until the selected page's own
        // data request (files/admin/etc.) and DOM rendering have completed.
        renderScreen(activeScreen||'home',overview);
        return null;
      });
    }).catch(function(error){
      if(!initData&&error&&(error.code==='browser_session_expired'||error.code==='browser_access_disabled')){browserSessionActive=false;startBrowserMode();return;}
      if(isApiGuardError(error))return;
      renderGlobalLoadError(error);
    });
  }
  var browserTelegramChallenge = null;
  function browserLoginDiagnostic(message){
    var copy=document.querySelector('.browser-auth-card .external-landing-copy');
    if(!copy)return;
    var old=copy.querySelector('.browser-login-diagnostic');if(old)old.remove();
    var box=document.createElement('div');box.className='browser-login-diagnostic';box.setAttribute('role','alert');box.textContent=String(message||'Не удалось выполнить вход через Telegram.');
    var cookieNote=copy.querySelector('.browser-cookie-notice');if(cookieNote)copy.insertBefore(box,cookieNote);else copy.appendChild(box);
  }
  function prepareBrowserTelegramChallenge(button){
    browserTelegramChallenge=null;
    if(button){button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='Подготовка входа…';}
    return window.BasaltApi.request('telegram_browser_nonce',{return_to:window.location.pathname+window.location.search},'').then(function(challenge){
      browserTelegramChallenge={data:challenge,createdAt:Date.now()};
      if(button){button.disabled=false;button.removeAttribute('aria-busy');button.textContent='Войти с помощью Telegram ↗';}
      return challenge;
    }).catch(function(error){
      if(button){button.disabled=true;button.removeAttribute('aria-busy');button.textContent='Вход временно недоступен';}
      browserLoginDiagnostic(error&&error.message?error.message:'Не удалось подготовить защищённый вход. Обновите страницу.');
      throw error;
    });
  }
  function bindBrowserTelegramLogin(button){
    if(!button)return;
    prepareBrowserTelegramChallenge(button).catch(function(){});
    button.addEventListener('click',function(){
      if(button.disabled)return;
      var challenge=browserTelegramChallenge;
      if(!challenge||!challenge.data||Date.now()-challenge.createdAt>540000){
        prepareBrowserTelegramChallenge(button).then(function(){browserLoginDiagnostic('Защищённый вход подготовлен. Нажмите кнопку ещё раз.');}).catch(function(){});return;
      }
      browserTelegramChallenge=null;
      button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='Переходим к Telegram…';
      var data=challenge.data;
      if(!data.redirect_uri||!data.exchange_relay_url){
        button.disabled=false;button.removeAttribute('aria-busy');button.textContent='Войти с помощью Telegram ↗';
        browserLoginDiagnostic('Не настроен callback или адрес защищённого relay. Проверьте config/database.php.');prepareBrowserTelegramChallenge(button).catch(function(){});return;
      }
      if(!data.state||!data.code_challenge){
        button.disabled=false;button.removeAttribute('aria-busy');button.textContent='Войти с помощью Telegram ↗';
        browserLoginDiagnostic('Сервер не подготовил state/PKCE. Обновите страницу и повторите попытку.');prepareBrowserTelegramChallenge(button).catch(function(){});return;
      }
      var authUrl=new URL('https://oauth.telegram.org/auth');
      authUrl.searchParams.set('client_id',String(data.client_id));
      authUrl.searchParams.set('redirect_uri',String(data.redirect_uri));
      authUrl.searchParams.set('response_type','code');
      authUrl.searchParams.set('scope','openid profile');
      authUrl.searchParams.set('state',String(data.state));
      authUrl.searchParams.set('nonce',String(data.nonce));
      authUrl.searchParams.set('code_challenge',String(data.code_challenge));
      authUrl.searchParams.set('code_challenge_method','S256');
      authUrl.searchParams.set('lang',(document.documentElement.lang||'ru').split('-')[0]);
      // Top-level redirect deliberately avoids a popup that Telegram Desktop may close
      // when it takes over the native tg:// OAuth request.
      window.location.assign(authUrl.toString());
    });
  }
  function renderBrowserLanding(browserEnabled, botName, forcedLanguage, loginConfigured){
    document.body.classList.add('external-open');
    // Keep the landing screen visible and hide only authenticated-app chrome.
    var shell=document.querySelector('.app-shell');
    if(shell){shell.hidden=false;shell.removeAttribute('hidden');shell.style.display='block';shell.style.visibility='visible';}
    app.hidden=false;
    app.removeAttribute('hidden');
    var topbar=document.querySelector('.topbar');if(topbar)topbar.hidden=true;
    var bottomNav=document.getElementById('bottomNav');if(bottomNav)bottomNav.hidden=true;
    var previewBadge=document.getElementById('previewBadge');if(previewBadge)previewBadge.hidden=true;
    app.className='external-open-screen';
    var lang=(navigator.language||'ru').toLowerCase(),landingLang=forcedLanguage|| (lang.indexOf('en')===0?'en':(lang.indexOf('kk')===0||lang.indexOf('kz')===0?'kz':'ru')); document.documentElement.lang=landingLang;
    var username=String(botName||window.BASALT_BOT_USERNAME||'').replace(/^@/,'').trim();
    var botHref=username?'https://t.me/'+encodeURIComponent(username)+'?start=webapp':'https://t.me/';
    var returnTo=window.location.pathname||'/';
    var copy={
      ru:{eyebrow:browserEnabled?'TELEGRAM AUTHENTICATION':'TELEGRAM WEB APP',title:browserEnabled?'Войти в Basalt Perfume':'Откройте Basalt Perfume в Telegram',body:browserEnabled?'Войдите с помощью своего Telegram-аккаунта, чтобы открыть каталог и личные данные.':'Для доступа к каталогу откройте приложение кнопкой WebApp в чате с ботом.',login:'Войти с помощью Telegram',setup:'Вход через Telegram не настроен: проверьте Client ID и HTTPS-адрес защищённого relay в config/database.php.',cookie:'Для входа используются cookie-файлы. Они сохраняют авторизацию в этом браузере на 7 дней. По истечении срока или после удаления cookie потребуется войти через Telegram заново. Cookie используются только для сессии входа.',footer:'Личный каталог · Безопасный вход через Telegram',telegram:'Открыть в Telegram'},
      en:{eyebrow:browserEnabled?'TELEGRAM AUTHENTICATION':'TELEGRAM WEB APP',title:browserEnabled?'Sign in to Basalt Perfume':'Open Basalt Perfume in Telegram',body:browserEnabled?'Sign in with your Telegram account to access your catalogue and personal data.':'To access the catalogue, open the app using the WebApp button in the bot chat.',login:'Continue with Telegram',setup:'Telegram sign-in is not configured: check the BotFather Client ID and the HTTPS token relay URL in config/database.php.',cookie:'This sign-in uses cookies to keep you logged in in this browser for 7 days. After the session expires or cookies are cleared, you will need to sign in with Telegram again. Cookies are used only for authentication.',footer:'Private catalogue · Secure Telegram sign-in',telegram:'Open in Telegram'},
      kz:{eyebrow:browserEnabled?'TELEGRAM АВТОРИЗАЦИЯСЫ':'TELEGRAM WEB APP',title:browserEnabled?'Basalt Perfume жүйесіне кіру':'Basalt Perfume қолданбасын Telegram ішінде ашыңыз',body:browserEnabled?'Каталог пен жеке деректерге қол жеткізу үшін Telegram аккаунтыңызбен кіріңіз.':'Каталогқа қол жеткізу үшін бот чатындағы WebApp батырмасын пайдаланыңыз.',login:'Telegram арқылы кіру',setup:'Telegram арқылы кіру бапталмаған: BotFather Client ID және config/database.php ішіндегі HTTPS relay мекенжайын тексеріңіз.',cookie:'Кіру үшін cookie файлдары қолданылады. Олар осы браузердегі авторизацияны 7 күн сақтайды. Мерзімі аяқталса немесе cookie жойылса, Telegram арқылы қайта кіру қажет. Cookie тек кіру сессиясы үшін пайдаланылады.',footer:'Жеке каталог · Telegram арқылы қауіпсіз кіру',telegram:'Telegram ішінде ашу'}
    };
    var text=copy[landingLang]||copy.ru;
    document.title='Basalt Perfume | '+(landingLang==='en'?'Sign in':(landingLang==='kz'?'Кіру':'Вход'));
    var loginControl=browserEnabled?(loginConfigured?'<button class="button full telegram-link" id="telegramLoginButton" type="button">'+esc(text.login)+' '+iconSvg('arrow')+'</button>':'<div class="browser-login-setup tiny muted">'+esc(text.setup)+'</div>'):'<a class="button full telegram-link" href="'+esc(botHref)+'" target="_blank" rel="noopener noreferrer">'+esc(text.telegram)+' '+iconSvg('arrow')+'</a>';
    app.innerHTML='<section class="external-telegram-card browser-auth-card" aria-labelledby="externalTelegramTitle"><div class="external-brand"><span class="external-brand-mark"><img class="brand-logo" src="/assets/img/logo.svg?v=2" alt="Basalt" width="44" height="44"></span><span><strong>BASALT</strong><small>PERFUME CENTER</small></span></div><div class="external-landing-copy"><p class="external-eyebrow">'+esc(text.eyebrow)+'</p><h1 id="externalTelegramTitle">'+esc(text.title)+'</h1><p>'+esc(text.body)+'</p>'+loginControl+(browserEnabled?'<div class="browser-cookie-notice">'+iconSvg('shield')+'<span>'+esc(text.cookie)+'</span></div>':'')+'</div><div class="external-language-switch" role="group" aria-label="Language / Язык"><button type="button" data-landing-lang="ru">RU</button><button type="button" data-landing-lang="en">EN</button><button type="button" data-landing-lang="kz">KZ</button></div><p class="external-footer">'+esc(text.footer)+'</p></section>';
    if(browserEnabled&&loginConfigured)bindBrowserTelegramLogin(document.getElementById('telegramLoginButton'));
    var switcher=document.querySelector('.external-language-switch');if(switcher)switcher.setAttribute('data-active-lang',landingLang);
    document.querySelectorAll('[data-landing-lang]').forEach(function(button){button.classList.toggle('active',button.getAttribute('data-landing-lang')===landingLang);button.setAttribute('aria-pressed',button.getAttribute('data-landing-lang')===landingLang?'true':'false');button.onclick=function(){renderBrowserLanding(browserEnabled,botName,button.getAttribute('data-landing-lang'),loginConfigured);};});
    document.documentElement.classList.remove('external-open-pending');revealUiChrome();
  }
  function startBrowserMode(){
    var authQuery=new URLSearchParams(window.location.search||'');
    var authError=authQuery.get('bp_tg_error');
    var authDetail=authQuery.get('bp_tg_detail')||'';
    var authSuccess=authQuery.get('bp_tg_login')==='1';
    // Every ordinary-browser request is normalized to a clean PHP route before
    // rendering, including the unauthenticated landing screen. Preserve callback
    // diagnostics across that one canonical redirect, then remove them from history.
    var canonical=canonicalBrowserRoute();
    var current=window.location.pathname+(window.location.search||'');
    if(canonical!==current){
      var canonicalUrl=new URL(canonical,window.location.origin);
      if(authError)canonicalUrl.searchParams.set('bp_tg_error',authError);
      if(authDetail)canonicalUrl.searchParams.set('bp_tg_detail',authDetail);
      if(authSuccess)canonicalUrl.searchParams.set('bp_tg_login','1');
      window.location.replace(canonicalUrl.pathname+(canonicalUrl.search||''));return;
    }
    if(authError||authSuccess){authQuery.delete('bp_tg_error');authQuery.delete('bp_tg_detail');authQuery.delete('bp_tg_login');var cleanUrl=window.location.pathname+(authQuery.toString()?'?'+authQuery.toString():'');window.history.replaceState({},document.title,cleanUrl);}
    window.BasaltApi.request('browser_status',{},'').then(function(state){
      botUsername=state.bot_username||botUsername;
      if(state.browser_access_enabled&&state.authenticated){bootstrapAuthenticatedApp();return;}
      renderBrowserLanding(!!state.browser_access_enabled,state.bot_username,undefined,!!state.telegram_login_configured);
      var messages={cancelled:'Вход через Telegram отменён.',not_configured:'Вход через Telegram не настроен: проверьте Client ID в конфигурации.',browser_disabled:'Доступ из браузера отключён администратором.',invalid_state:'Telegram вернул пользователя, но сайт не нашёл исходную PHP-сессию. Обычно причина — разные адреса www и без www, либо блокировка cookie.',token_exchange_failed:'Используется устаревший способ входа. Обновите страницу и локальный Telegram Login SDK.',invalid_id_token:'Telegram вернул токен, который сервер не смог проверить. Проверьте Client ID, локальный JWKS и RS256.',invalid_user_data:'Telegram авторизовал аккаунт, но сервер не смог прочитать профиль.',user_persist_failed:'Telegram подтвердил вход, но сервер не смог сохранить профиль в базе данных.',site_url_must_be_https:'Для Telegram Login нужен HTTPS и корректный site_url в конфигурации.',server_crypto_unavailable:'На сервере недоступны криптографические функции PHP.',authorization_failed:'Не удалось завершить авторизацию через Telegram.'};
      var diagnosticText=authError?(messages[authError]||'Не удалось войти через Telegram. Код: '+authError):(authSuccess?'Telegram подтвердил вход, но сайт не получил сохранённую cookie-сессию. Проверьте, что адрес сайта и site_url в config/database.php используют один и тот же домен (с www или без www), а браузер разрешает cookie.':'');
      if(diagnosticText){
        var diagnostic=document.createElement('div');diagnostic.className='browser-login-diagnostic';diagnostic.setAttribute('role','alert');
        var diagnosticMessage=document.createElement('div');diagnosticMessage.textContent=diagnosticText;diagnostic.appendChild(diagnosticMessage);
        if(authError==='token_exchange_failed'&&authDetail){
          var detail=document.createElement('div');detail.className='browser-login-diagnostic-detail';
          detail.textContent='Диагностика сервера: '+authDetail;
          diagnostic.appendChild(detail);
        }
        var copy=document.querySelector('.browser-auth-card .external-landing-copy');
        if(copy){var cookieNote=copy.querySelector('.browser-cookie-notice');if(cookieNote)copy.insertBefore(diagnostic,cookieNote);else copy.appendChild(diagnostic);}
        if(authError)toast(diagnosticText+(authDetail?' Детали: '+authDetail:''));
      }
    }).catch(function(error){renderGlobalLoadError(error);});
  }
  if(!initData){startBrowserMode();return;}

  document.documentElement.classList.remove('external-open-pending');
  bootstrapAuthenticatedApp();
})();
