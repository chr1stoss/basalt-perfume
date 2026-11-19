(function (window, document) {
  'use strict';
  var root = document.documentElement;
  var telegramData = '';
  try {
    telegramData = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) || '';
    if (!telegramData) {
      var hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
      var query = new URLSearchParams(window.location.search || '');
      telegramData = hash.get('tgWebAppData') || query.get('tgWebAppData') || '';
    }
  } catch (error) {}

  var ua = String((window.navigator && window.navigator.userAgent) || '');
  var platform = String((window.navigator && window.navigator.platform) || '');
  var uaDataMobile = !!(window.navigator && window.navigator.userAgentData && window.navigator.userAgentData.mobile === true);
  var mobileUa = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Windows Phone/i.test(ua);
  var ipadOs = platform === 'MacIntel' && Number(window.navigator && window.navigator.maxTouchPoints) > 1;
  var compactTouch = false;
  try {
    compactTouch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches && Math.min(Number(window.screen && window.screen.width) || window.innerWidth, window.innerWidth) <= 900);
  } catch (error) {}

  var mode = telegramData ? 'telegram-webapp' : ((uaDataMobile || mobileUa || ipadOs || compactTouch) ? 'mobile-browser' : 'desktop-browser');
  window.BasaltUiMode = mode;
  root.setAttribute('data-bp-ui-mode', mode);

  // Telegram owns its own launch URLs. Ordinary browsers are redirected to their
  // matching shell before CSS or the app bundle can paint the wrong layout.
  if (mode === 'telegram-webapp') return;
  var path = window.location.pathname || '/';
  var routeMap = {
    '/': 'home', '/index.html': 'home', '/mobile/index.html': 'home', '/index.php': 'home', '/home': 'home', '/home/': 'home',
    '/prices.html': 'prices', '/prices.php': 'prices', '/prices': 'prices', '/prices/': 'prices',
    '/subscription.html': 'subscription', '/subscription.php': 'subscription', '/subscription': 'subscription', '/subscription/': 'subscription',
    '/settings.html': 'settings', '/settings.php': 'settings', '/settings': 'settings', '/settings/': 'settings',
    '/admin.html': 'admin', '/admin.php': 'admin', '/admin': 'admin', '/admin/': 'admin',
    '/search.html': 'search', '/search.php': 'search', '/search': 'search', '/search/': 'search',
    '/notifications.html': 'notifications', '/notifications.php': 'notifications', '/notifications': 'notifications', '/notifications/': 'notifications',
    '/notification.html': 'notifications', '/notification.php': 'notifications', '/notification': 'notifications', '/notification/': 'notifications',
    '/support.html': 'support', '/support.php': 'support', '/support': 'support', '/support/': 'support'
  };
  var match = path.match(/^\/m\/(home|prices|subscription|settings|admin|search|notifications|support)\/?$/);
  var screen = match ? match[1] : routeMap[path];
  if (!screen) return;

  var destination = (mode === 'mobile-browser' ? '/m/' : '/') + screen;
  var params = new URLSearchParams(window.location.search || '');
  var carried = new URLSearchParams();
  if (screen === 'search' && params.get('mode') === 'best') carried.set('mode', 'best');
  ['bp_tg_error', 'bp_tg_detail', 'bp_tg_login'].forEach(function (key) {
    if (params.has(key)) carried.set(key, params.get(key));
  });
  var suffix = carried.toString();
  var target = destination + (suffix ? '?' + suffix : '');
  var current = path + (window.location.search || '');
  if (target !== current) window.location.replace(target);
})(window, document);
