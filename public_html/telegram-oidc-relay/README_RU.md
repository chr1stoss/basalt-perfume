# Защищённый relay Telegram OIDC для Basalt Perfume

PHP-хостинг Basalt не может открыть исходящее соединение к `oauth.telegram.org:443`. Этот Cloudflare Worker выполняет только серверный обмен одноразового authorization code на ID token. `Client Secret` хранится как Cloudflare Worker Secret и никогда не попадает в браузер или PHP-конфиг.

## Создание Worker

1. Откройте Cloudflare Dashboard → Workers & Pages → Create → Worker.
2. Назовите его, например, `basalt-telegram-oidc-relay`.
3. Замените содержимое файла Worker кодом из `worker.js` и Deploy.
4. В Settings → Variables and Secrets добавьте обычные Variables:
   - `TELEGRAM_CLIENT_ID` — Client ID из BotFather.
   - `ALLOWED_ORIGIN` — `https://basalt-parfume.shop` (без завершающего `/`).
   - `ALLOWED_REDIRECT_URI` — `https://basalt-parfume.shop/telegram-login-callback.html`.
5. Добавьте Secret `TELEGRAM_CLIENT_SECRET` — актуальный Client Secret из BotFather. Не вставляйте его в Basalt, чаты или клиентский JS.
6. Скопируйте Worker URL, например `https://basalt-telegram-oidc-relay.<account>.workers.dev`.
7. В серверном `config/database.php` добавьте:

```php
'telegram_login_exchange_relay_url' => 'https://YOUR-WORKER.workers.dev',
```

Также проверьте `telegram_login_client_id` и `site_url` (`https://basalt-parfume.shop`).

## BotFather

- Trusted Origins: `https://basalt-parfume.shop` (оставить).
- Redirect URIs: добавить ТОЧНО `https://basalt-parfume.shop/telegram-login-callback.html`.
- RS256: оставить.
- Client Secret: хранить только как Worker Secret; если прежний секрет публиковался, сначала Revoke и использовать новый.

## Поток

1. Basalt запрашивает одноразовый nonce у своего PHP API (PHP сессия).
2. Браузер генерирует `state` и PKCE verifier/challenge и делает top-level redirect на `https://oauth.telegram.org/auth` с `response_type=code`.
3. После подтверждения Telegram возвращает браузер на callback-страницу Basalt с `code` и `state`.
4. Callback проверяет `state`, отправляет `code` и PKCE verifier в Worker.
5. Worker обменивает код на Telegram token server-to-server, используя секрет, и возвращает только `id_token`.
6. Callback передаёт `id_token` в Basalt PHP. PHP локально проверяет RS256, issuer, audience, expiration и nonce, затем устанавливает 7-дневную HttpOnly cookie.

## Проверка

Откройте Worker URL в браузере методом GET: ответ `method_not_allowed` означает, что Worker отвечает. Это нормально. Реальный POST отправляется только callback-страницей. В DevTools на callback должны быть POST к Worker со статусом 200, затем POST к `api.php` со статусом 200. Не включайте логирование request body: там находятся одноразовый code и PKCE verifier.
