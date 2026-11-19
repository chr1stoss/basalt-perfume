# Basalt Perfume Web API

Документация описывает web API Basalt Perfume. Это внутренний API приложения, а не публичный стабильный SDK. Публичный маршрут `/api.php` и формат запросов/ответов сохраняются между релизами.


## Реализация и модули

Публичный URL остаётся `POST /api.php`. Файл `public_html/api.php` теперь является тонкой точкой входа и подключает `public_html/api/bootstrap.php` и `public_html/api/router.php`. Общие функции разделены по доменам в `public_html/api/lib/` (БД, Telegram, авторизация, подписки, загрузки, скачивания). Обработчики действий находятся в `public_html/api/handlers/`: авторизация, профиль, сессии, прайс-листы, каталог, избранное, уведомления, настройки и администрирование. Прямой HTTP-доступ к `/api/` запрещён; модули подключаются только внутренним PHP `require`.

Клиентский контракт не изменён: `assets/js/core/api.js` продолжает отправлять запросы на `/api.php`, action names и JSON envelope сохранены. Исключение для подписанного скачивания по `GET /api.php?download_token=...` также сохранено.

## Base URL

```text
https://YOUR_DOMAIN/api.php
```

Обычные действия API отправляются методом `POST` с JSON body. API использует общую серверную сессию/авторизацию и PDO-доступ к MySQL. Для браузерной сессии применяется CSRF/origin защита. GET/OPTIONS не предназначены для обычных действий API.

**Специальное исключение:** `GET /api.php?download_token=...` (и допустимый OPTIONS preflight) используется только для получения файла по короткоживущему подписанному токену. Это не общий GET API.

## Response envelope

Типовой ответ:

```json
{
  "ok": true,
  "data": {}
}
```

При ошибке `ok` равно `false`, а в `data` возвращается безопасный код ошибки/сообщение. HTTP status должен использоваться вместе с `ok`; не полагайтесь только на текст сообщения.

## Actions

| Action | Назначение |
|---|---|
| `browser_logout` | Завершить browser session и очистить cookie |
| `browser_status` | Проверить состояние browser login |
| `telegram_browser_nonce` | Получить nonce для Telegram OIDC |
| `telegram_browser_code_prepare` | Подготовить browser code exchange flow |
| `telegram_browser_verify` | Завершить browser verification |
| `telegram_oidc_start`, `telegram_oidc_callback` | Серверные этапы Telegram OIDC |
| `telegram_login` | Вход из Telegram Mini App по initData |
| `session_sync` | Синхронизация состояния сессии |
| `activate_subscription_key` | Активировать subscription key |
| `overview`, `me` | Получить профиль, роль и сводное состояние |
| `upload_price_list` | Принять загрузку прайс-листа |
| `stage_price_list` | Подготовить staged upload |
| `request_upload_scan` | Запросить проверку staged upload |
| `upload_review_status` | Получить состояние проверки загрузки |
| `finalize_upload_batch` | Завершить batch загрузки |
| `cancel_upload_batch` | Отменить batch загрузки |
| `upload_accepted_notification` | Создать уведомление о принятии загрузки |
| `create_download_link` | Создать короткоживущую подписанную ссылку для скачивания |
| `files` | Получить список доступных пользователю прайс-листов |
| `delete_file` | Удалить доступный пользователю файл |
| `brands` | Получить бренды каталога |
| `filter_options` | Получить варианты фильтров |
| `products`, `best_prices` | Поиск товаров и лучших цен |
| `product_details` | Получить подробности товара |
| `favorites`, `favorite_toggle` | Получить/изменить избранное |
| `notifications` | Получить уведомления |
| `mark_read`, `mark_all_read` | Отметить одно/все уведомления прочитанными |
| `settings`, `save_settings` | Получить/сохранить настройки пользователя |
| `support` | Получить данные раздела поддержки/FAQ |
| `reveal_subscription_key` | Показать ключ подписки при наличии прав |
| `set_price_multiplier` | Изменить множитель цены |
| `admin_stats` | Административная статистика |
| `save_browser_features` | Сохранить настройки browser access |
| `save_maintenance` | Изменить режим обслуживания |
| `admin_change_user_key` | Административная смена ключа пользователя |
| `generate_keys` | Генерация ключей активации |
| `create_announcement` | Создать объявление/рассылку |

Список выше — карта действий из текущего исходника, а не полная спецификация каждого JSON schema. Для точных полей смотрите соответствующий файл в `public_html/api/handlers/` и клиентский вызов в `public_html/assets/app.js` / `assets/js/core/api.js`.

## Download flow

1. Авторизованный клиент отправляет `POST` action `create_download_link` с идентификатором прайс-листа или запросом bulk download.
2. PHP проверяет пользователя, роль, право доступа и наличие файла.
3. PHP формирует подписанный HMAC-токен с коротким сроком действия (текущая реализация возвращает `expires_in: 300`).
4. Клиент открывает полученный URL `/api.php?download_token=...`:
   - обычный браузер — стандартная загрузка;
   - Telegram WebApp — `Telegram.WebApp.downloadFile()` если API доступен;
   - fallback — открытие ссылки.
5. PHP проверяет подпись/срок действия и повторно проверяет право доступа перед выдачей файла.

Файл хранится вне DocumentRoot. Telegram bot не получает файл и не отправляет его пользователю.

## Security rules

- Не передавайте MySQL credentials, bot token, Client Secret или encryption secret в JSON response.
- Не логируйте Telegram initData, OIDC authorization code, PKCE verifier, signed download token или session cookies.
- Не отключайте CSRF/origin validation для browser session.
- Не добавляйте GET handlers для обычных API actions.
- Ссылки скачивания нельзя считать постоянными или публичными; не кэшируйте их.
- Не раскрывайте абсолютные пути приватного storage.
- Административные actions требуют серверной проверки роли; скрытие кнопки на frontend не является контролем доступа.

## Local examples

Пример запроса (поля действия должны соответствовать handler):

```bash
curl -X POST 'http://localhost:8080/api.php' \
  -H 'Content-Type: application/json' \
  -d '{"action":"support"}'
```

В реальном браузерном контексте нужны cookie/CSRF headers, которые формирует клиент приложения. Не используйте этот упрощённый curl пример для обхода авторизации.
