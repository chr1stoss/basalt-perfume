(function (window, document) {
  'use strict';
  var api = {
    init: function (code) {
      var lang = (navigator.language || 'ru').toLowerCase();
      lang = lang.indexOf('en') === 0 ? 'en' : ((lang.indexOf('kk') === 0 || lang.indexOf('kz') === 0) ? 'kz' : 'ru');
      var switcher = document.querySelector('.external-language-switch');
      var home = document.querySelector('[data-error-home]');
      var footer = document.querySelector('[data-error-footer]');
      var homeText = {ru: 'На главную', en: 'Home', kz: 'Басты бет'};
      var footerText = {ru: 'Личный каталог · Авторизация через Telegram', en: 'Private catalogue · Telegram authentication', kz: 'Жеке каталог · Telegram арқылы авторизация'};
      function setLanguage(next) {
        document.querySelectorAll('[data-error-copy]').forEach(function (copy) { copy.hidden = copy.getAttribute('data-error-copy') !== next; });
        document.querySelectorAll('[data-external-lang]').forEach(function (button) {
          var active = button.getAttribute('data-external-lang') === next;
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        if (switcher) switcher.setAttribute('data-active-lang', next);
        if (home) home.textContent = homeText[next] || homeText.ru;
        if (footer) footer.textContent = footerText[next] || footerText.ru;
        document.documentElement.lang = next === 'kz' ? 'kk' : next;
        document.title = String(code) + ' · PERFUME CENTER';
      }
      document.querySelectorAll('[data-external-lang]').forEach(function (button) {
        button.addEventListener('click', function () { setLanguage(button.getAttribute('data-external-lang') || 'ru'); });
      });
      setLanguage(lang);
    }
  };
  window.BasaltExternalPages = api;
})(window, document);
