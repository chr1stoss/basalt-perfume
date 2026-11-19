(function (window) {
  'use strict';
  var roles = [
    { value: 'admin', role: 'admin', scenario: 'normal', title: 'Администратор', desc: 'Панель и интерфейс администратора' },
    { value: 'seller', role: 'seller', scenario: 'normal', title: 'Продавец', desc: 'Прайс-листы и управление множителем цены' },
    { value: 'buyer', role: 'buyer', scenario: 'normal', title: 'Покупатель', desc: 'Поиск и просмотр цен' },
    { value: 'seller_maintenance', role: 'seller', scenario: 'maintenance', title: 'Продавец · тех. работы', desc: 'Экран недоступности во время тех. работ' },
    { value: 'buyer_maintenance', role: 'buyer', scenario: 'maintenance', title: 'Покупатель · тех. работы', desc: 'Экран недоступности во время тех. работ' },
    { value: 'seller_banned', role: 'seller', scenario: 'banned', title: 'Продавец · заблокирован', desc: 'Экран заблокированного аккаунта' },
    { value: 'buyer_banned', role: 'buyer', scenario: 'banned', title: 'Покупатель · заблокирован', desc: 'Экран заблокированного аккаунта' },
    { value: 'none', role: 'none', scenario: 'normal', title: 'Без роли', desc: 'Просмотр интерфейса без назначенной роли' }
  ];
  function render(headingHtml) {
    return headingHtml + '<div class="preview-role-grid">' + roles.map(function (role) {
      return '<button type="button" class="action-card preview-role-card" data-preview-role="' + role.value + '"><strong>' + role.title + '</strong><span class="tiny muted">' + role.desc + '</span></button>';
    }).join('') + '</div>';
  }
  function bind(root, onChoose) {
    root.querySelectorAll('[data-preview-role]').forEach(function (button) {
      button.addEventListener('click', function () {
        var value = button.getAttribute('data-preview-role');
        var role = roles.filter(function (item) { return item.value === value; })[0];
        var title = button.querySelector('strong');
        onChoose(value, title ? title.textContent : value, role ? role.role : value, role ? role.scenario : 'normal');
      });
    });
  }
  window.BasaltPreview = { render: render, bind: bind };
})(window);
