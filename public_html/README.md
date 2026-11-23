# Basalt Perfume Web v13.10.20

# Basalt Perfume Web — PERFUME CENTER

## Обзор

WebApp предоставляет каталог парфюмерии, обработанные прайс-листы, поиск и сравнение цен, избранное, уведомления, управление подпиской и административные инструменты. Поддерживаются русский, английский и казахский языки.

В v13.10.20 Telegram WebApp, мобильный браузер и desktop-браузер определяются как три отдельных режима; мобильная и desktop-оболочки физически разделены. Серверная часть остаётся на PHP: браузер не подключается к MySQL напрямую.

## Структура

- `mobile/` — отдельные HTML-страницы мобильной оболочки. Telegram WebApp использует сохранённые адреса `/index.html`, `/prices.html` и т. д.; мобильный браузер использует `/m/home`, `/m/prices` и другие `/m/...` маршруты.
- `desktop/` — отдельные PHP-страницы обычного браузера; чистые адреса `/home`, `/prices`, `/subscription`, `/settings`, `/admin`, `/search`, `/notifications`, `/support`. Переходы создают записи в истории браузера, поэтому Back/Forward и обновление сохраняют текущий раздел.
- `assets/app.js`, `assets/js/`, `assets/app.css` — общее UI-ядро, API-клиент и локализации. `assets/mobile/` и `assets/desktop/` содержат платформенные стили.
- `assets/img/` — логотип, favicon и изображения. Пользовательские PNG не включены.
- `api.php` — стабильная точка входа API; все доменные обработчики находятся в `api/handlers/`, общие функции — в `api/lib/`.
- `config/database.php` — параметры подключения к MySQL; каталог защищён от прямого доступа правилами сервера.
- `migrations/` — SQL-миграции, которые применяются вручную через phpMyAdmin, если конкретное обновление этого требует.
- `errors/` — локализованные страницы 401, 403, 404 и 500 для открытия в обычном браузере.

## Установка / обновление через FTP или файловый менеджер

1. Сделайте резервную копию текущего каталога WebApp и базы данных.
2. Для Sweb используйте отдельные места назначения: содержимое `UPLOAD_TO_HOME/` переносится в `/home/<логин>/`, а содержимое `UPLOAD_TO_SITE/` — в Document Root сайта. Приватный Python-пакет обработки находится в `/home/<логин>/private/basalt-site-worker/`, отдельно от публичного сайта. Полная схема и команды приведены в `INSTALL_UPDATE_V13_4_RU.md`.
3. После распаковки v13 удалите старые дубли страниц из корня (`index.html`, остальные пользовательские `*.html`, `telegram-login-callback.html` и восемь старых пользовательских `*.php`). Не трогайте `api.php`, `api/`, `config/`, `uploads/` и `errors/`: новые страницы находятся в `mobile/` и `desktop/`. Публичные прежние URL продолжают обслуживаться через `.htaccess`.
4. **Не удаляйте и не заменяйте** действующий `config/database.php`: в обновляющем архиве этот приватный файл намеренно отсутствует, чтобы не распространять пароли и токены. При распаковке поверх текущего проекта ваш файл останется на месте. Если вы пересоздаёте каталог целиком, восстановите `config/database.php` из резервной копии. В архиве есть безопасный шаблон `config/database.example.php`.
5. **Сохраните также `api/lib/database.php`**. `api/bootstrap.php` подключает этот обязательный модуль для работы с MySQL; в предоставленном архиве он отсутствует, так как файлы с именем `database.php` исключены правилами `.gitignore`. Не удаляйте действующую серверную копию. Если её нет, API не запустится — восстановите модуль из предыдущей рабочей версии проекта.
6. Убедитесь, что `api.php`, `api/`, `config/`, `assets/`, `errors/` и `uploads/` находятся в ожидаемых местах. Для HTML-варианта сервер всё равно должен исполнять PHP для API.
6. Сбросьте кэш браузера или откройте страницу в приватном окне. Параметры версий CSS/JS повышены для обновления кэша.
7. Проверьте открытие стартовой страницы в браузере, вход через Telegram, каталог и настройки языка RU/EN/KZ.

### Mobile и desktop — две оболочки одного приложения

Telegram WebApp использует страницы из `mobile/` и сохранённые корневые URL `*.html`. Обычный браузер компьютера использует PHP-страницы из `desktop/` по чистым URL. Обычный браузер телефона/планшета открывает ту же мобильную оболочку, но в отдельном режиме `mobile-browser`. Все три режима обращаются к одному `api.php`, одной базе данных и общей серверной бизнес-логике.

## Темы и языки

Выбор языка браузерной страницы определяется языком браузера при первом открытии, но его можно изменить переключателем RU / EN / KZ. Для обычной браузерной страницы нижняя группа действий закреплена внизу карточки, чтобы более длинный казахский текст не сдвигал кнопку, переключатель и подпись.

## Страницы ошибок и favicon

`errors/401.html`, `errors/403.html`, `errors/404.html` и `errors/500.html` имеют общий фон, логотип, favicon и переключатель языка. Проверьте соответствующие `ErrorDocument` правила в `.htaccess` на вашем хостинге.

## Ресурсы и инструменты разработчика

Названия файлов, содержимое HTML/CSS/JS и сетевые запросы, отправленные браузеру, нельзя надёжно зашифровать от посетителя: DevTools показывает ресурсы, необходимые для отображения страницы. Для production можно минифицировать JS/CSS, отключить публикацию source maps и генерировать имена файлов с content hash. Это усложняет чтение и угадывание имён, но не скрывает код и не защищает секреты. Пароли, токены и правила доступа должны оставаться на сервере.

## Безопасность

- Никогда не помещайте `BOT_TOKEN`, пароли MySQL или серверные ключи в JavaScript.
- Не отключайте проверку Telegram `initData` на сервере.
- Перед импортом SQL и обновлением файлов создавайте резервную копию.
- Не выполняйте `migrations/*.sql` повторно без проверки содержимого и текущей схемы.


## Новые возможности браузера и загрузки прайс-листов

1. Сделайте резервную копию БД. Если таблицы `web_upload_jobs` ещё нет, один раз примените `migrations/007_browser_access_and_web_uploads.sql` (она подготавливает базовые настройки браузерного доступа и связанную очередь); если таблица уже существует, повторно 007 не запускайте. Для отдельной очереди сайта обязательно один раз примените новую `migrations/008_website_upload_queue.sql` (создаёт `web_upload_site_jobs`). Старая очередь приложения остаётся независимой; web-worker читает только новую таблицу.
2. Новый путь для web-загрузок — `/home/<логин>/uploaded_filed/<telegram_user_id>/`; он находится вне публичного Document Root. Для новых файлов задайте один и тот же абсолютный путь в `UPLOAD_STORAGE_DIR` приватного `.env` worker и в `web_upload_storage_dir` существующего `config/database.php`. Старая настройка `price_list_storage_dir` может оставаться для скачивания ранее загруженных файлов. Старые файлы автоматически не перемещаются.
3. Сохраните существующий приватный `config/database.php`; добавьте в его возвращаемый массив `web_upload_storage_dir` с тем же абсолютным путём, что и в `.env`. PHP должен иметь право создавать файлы в `uploaded_filed`, а Python-worker — читать их.
4. В PHP-конфигурации сохраните корректные `bot_username`, `site_url` и подключение к общей БД. Telegram OIDC Client ID/relay URL и JWKS оставьте без изменений.
5. Для обработки Excel настройте отдельный cron-worker `scripts/web_upload_worker.py`. Он использует парсер из приватного пакета `/home/<логин>/private/basalt-site-worker/` и общую MySQL. Зависимости устанавливаются в приватный `.venv`; подробности — в `INSTALL_UPDATE_V13_4_RU.md`.
6. В блоке «Доступ к сайту» админ-панели доступны отдельные настройки обычного браузера, синхронизации сессий и обязательной подписки для покупателей. «Подписка для покупателей» по умолчанию включена: это сохраняет прежнее поведение. При выключении профили без назначенной роли автоматически получают роль `buyer`, чтобы новый пользователь мог войти без ключа; существующие роли `seller` и `admin` сохраняются. Это означает открытое создание покупательских аккаунтов для вошедших через Telegram пользователей. При включении новые профили без роли остаются на прежнем экране ограничения доступа до назначения роли/активации ключа. Настройка хранится в `app_settings`, поэтому отдельная SQL-миграция не требуется.

Браузерная авторизация выполняется через Telegram OpenID Connect; после успешной серверной проверки ID-токена PHP устанавливает HttpOnly/SameSite cookie с семидневным сроком. При отсутствии/истечении cookie пользователь снова увидит экран входа и уведомление об использовании cookie.

Веб-загрузка принимает несколько файлов и ставит задания в отдельную `web_upload_site_jobs`. Приватный Python worker запускается через cron и читает только эту очередь. Worker открывает XLSX-книгу и передаёт строки парсеру прайс-листов; если не распознано ни одной товарной строки, задача завершается статусом ошибки, а товары в каталог не записываются. Это проверка результата парсинга, а не раннее определение типа документа: большая неподходящая таблица всё равно может потребовать времени на чтение и анализ. На стороне PHP задайте `upload_max_filesize` и `post_max_size` не меньше 20M; приложение применяет лимит `max_upload_mb` и `max_file_size_mb`.

## Раздельные страницы и desktop

Страницы Telegram WebApp находятся в `mobile/`, а PHP-страницы обычного браузера — в `desktop/`. Общие API, БД и бизнес-логика находятся в общей серверной части. Стили разделены на `assets/mobile/` и `assets/desktop/`; базовые компоненты и поведение переиспользуются. Desktop-режим использует левую боковую панель, компактную верхнюю навигацию и ограниченную ширину контента. В браузере уже на узких экранах desktop-оболочка переходит к мобильной компоновке.


### Вход через Telegram Account (актуальный redirect flow v11)

Обычный браузер использует top-level OIDC Authorization Code Flow + PKCE без popup и без `telegram-login.js`. После подтверждения Telegram возвращает браузер на `telegram-login-callback.html`. Поскольку PHP-хостинг Basalt не может напрямую подключиться к `oauth.telegram.org:443`, обмен одноразового authorization code выполняет Cloudflare Worker из `telegram-oidc-relay/`; Client Secret хранится только в Worker Secret. PHP проверяет ID token локальным `config/telegram-jwks.json`, `iss`, `aud`, `exp`, `iat` и `nonce`, после чего создаёт семидневную HttpOnly-cookie.

В BotFather → Login Widget укажите Trusted Origin `https://basalt-parfume.shop`, Redirect URI `https://basalt-parfume.shop/telegram-login-callback.html`, Signing Algorithm `RS256 (Default)`. В `config/database.php` должны быть `telegram_login_client_id`, `telegram_login_exchange_relay_url` и правильный `site_url`. Client Secret в PHP, HTML или JS не добавляйте — он хранится в Cloudflare Worker Secret. Подробности: `TELEGRAM_LOGIN_SETUP_RU.md` и `telegram-oidc-relay/README_RU.md`. `telegram-web-app.js` по-прежнему нужен для запуска Mini App внутри Telegram; `telegram-login.js` для текущего redirect flow не используется.

Нижняя навигация скрыта до завершения получения роли и настроек пользователя. До показа рассчитывается правильное количество колонок (в том числе пятая кнопка администратора), а SVG-иконки имеют фиксированные размеры. Это предотвращает первоначальную перестройку видимого navbar при запуске каждой отдельной HTML-страницы.


---

# Telegram Login v11: redirect flow

В актуальной версии вход выполняется через top-level OIDC Authorization Code Flow + PKCE, без popup/`postMessage`. После подтверждения Telegram возвращает браузер на `telegram-login-callback.html`. Обмен authorization code выполняется отдельным Cloudflare Worker из `telegram-oidc-relay/`, поскольку PHP-хостинг не имеет исходящего HTTPS-доступа к Telegram. Client Secret хранится только в Worker Secret. Полная инструкция: `INSTALL_UPDATE_V11_RU.md` и `telegram-oidc-relay/README_RU.md`. В BotFather нужно добавить Redirect URI `https://basalt-parfume.shop/telegram-login-callback.html`; Trusted Origin `https://basalt-parfume.shop` оставить; RS256 оставить.


## Browser/Desktop mode update (v12)

- Telegram WebApp continues to use the `.html` entry pages.
- All ordinary-browser visits, including the sign-in landing page, are canonicalized to clean routes and served by PHP entry points: `/home`, `/prices`, `/subscription`, `/settings`, `/admin`, `/search`, `/notifications`, `/support`. The legacy `/notification` alias redirects to `/notifications`.
- Desktop browser CSS is loaded from `assets/desktop/desktop.css`; Telegram WebApp uses its own layer from `assets/mobile/mobile.css`.
- Browser logout calls the `browser_logout` API action and expires the `BASALTPERFUME` session cookie.
- Hashed cached avatar files in `uploads/avatars` receive immutable cache headers. Existing raster avatar generation is unchanged; pre-existing hash-named SVG cache entries are now recognized.


## Архитектура v13

- `mobile/` и `desktop/` полностью разделяют HTML-оболочку Telegram WebApp и PHP-оболочку обычного браузера. Внутренний API, конфигурация БД и серверные бизнес-правила общие.
- Выбор представления автоматический: Telegram WebApp продолжает открывать HTML URL; обычный браузер приводит адрес к чистому маршруту и получает PHP-оболочку. Узкий браузерный экран использует компактную мобильную компоновку.
- Для desktop добавлены боковая навигация, компактная верхняя навигация, breadcrumb, независимые колонки административной панели и центрированные диалоги.
- Начиная с v13.3 активация ключей на сайте включена постоянно и не управляется отдельным переключателем. Проверка ключа и атомарная транзакция выполняются общей серверной логикой сайта.
- OIDC callback сохраняет прежний публичный адрес `/telegram-login-callback.html`; Worker и BotFather перенастраивать не нужно.

## Установка обновления v13

1. Сделайте резервную копию web-каталога и БД.
2. Распакуйте архив поверх web-проекта. Сохраните действующие `config/database.php`, `uploads/` и серверные секреты. В архиве нет боевого `database.php`.
3. Убедитесь, что PHP обрабатывает файлы в `desktop/`, а Apache поддерживает `.htaccess` и `mod_rewrite`. Для Nginx перенесите правила маршрутизации в конфигурацию Nginx.
4. Корневой каталог должен обслуживать `mobile/index.html` для Telegram WebApp и обычного `/`; браузерный JS перенаправит обычный вход на `/home`. Telegram продолжает использовать `/index.html` и остальные `.html` маршруты.
5. В `.htaccess` сохранены старый callback `/telegram-login-callback.html`, редирект `/auth` и заголовок `Cross-Origin-Opener-Policy`.
6. Начиная с v13.3 активация ключей на сайте включена постоянно; отдельная настройка в `app_settings` больше не используется. SQL-миграция для этого изменения не требуется.
7. Очистите CDN/серверный кэш. Проверьте вход из Telegram, браузерный OIDC-вход, Back/Forward, открытие разделов и активацию ключа непосредственно на сайте.


## Desktop UI refinements (v13, второй пакет исправлений)

- Широкий браузерный режим (от 900 px) использует закреплённую левую панель; верхний горизонтальный header скрыт. В меню доступны главная, прайсы, подписка, настройки, админ-панель, уведомления, поиск товаров и поддержка. На узком экране браузер сохраняет компактную мобильную компоновку.
- Начальная загрузка каталога использует 16 точек 4×4 и центрированную карточку с ограниченной шириной.
- Desktop-диалоги имеют увеличенный верхний отступ и отдельную SVG-кнопку закрытия; закрытие кликом по фону сохранено.
- Статистическая сводка главной страницы использует пять колонок; блок пользователя и подписки получил более крупный аватар.
- В настройках уплотнены секции приватности и уведомлений, увеличена высота кнопок выбора темы, основные действия ограничены по ширине.
- В админ-панели независимые колонки сохраняют последовательный порядок блоков; публикация обновления выравнивается по высоте с блоком ключей. Списки ключей и пользователей ограничены примерно тремя строками (max-height: 220px) и прокручиваются внутри карточек на desktop и mobile.
- Дополнены переводы RU/EN/KZ, включая динамические административные диалоги, карточку товара, окно множителя цены и подписи дней недели в календарях. Короткие части слов не используются как глобальные ключи перевода.
- Установка: см. `INSTALL_UPDATE_V13_DESKTOP_REFINEMENTS_RU.md`. SQL-миграция, изменение Cloudflare Worker и перенастройка BotFather не требуются.


## v13.3 — web upload processing

- Файлы новых web-загрузок сохраняются в приватный `../uploaded_filed/<telegram_user_id>/`, вне web-root.
- Форма поддерживает множественный выбор; запросы отправляются асинхронно (до двух параллельно).
- Обработку выполняет отдельный `scripts/web_upload_worker.py`; он импортирует парсер из `/home/<логин>/private/basalt-site-worker/` и запускается cron с приватным Python virtualenv. См. `INSTALL_UPDATE_V13_4_RU.md`.
- Настройки «Загрузка и скачивание прайс-листов на сайте» и «Активация ключей на сайте» убраны из админки; обе функции включены на сайте. Доступ к обычному браузеру по-прежнему настраивается отдельно.


## v13.4 — desktop/mobile polish and upload queue diagnostics

- Desktop breadcrumb is fixed to the viewport with a translucent panel; the 4×4 loading indicator uses one persistent overlay and does not jump between layout containers.
- Support FAQ typography is explicitly inherited and consistent across desktop/mobile.
- File-status polling now sends one `api.php` (тонкий front controller; обработчики находятся в `api/handlers/`, общие функции — в `api/lib/`) request per refresh interval; the previous polling path could trigger a second full `renderPrices()` fetch and create 2–3 requests per cycle.
- Website upload statuses expose queue attempts and processing errors. The worker heartbeats long-running jobs, recovers stale locks, and marks repeatedly crashed jobs as failed instead of leaving them in `processing` indefinitely.
- Clock-number clicks no longer bubble into the analog-dial drag handler.
- Profile role labels remain canonical (`ADMIN`, `SELLER`, `BUYER`, `NONE`) in every language.
- File deletion uses a five-second in-button confirmation instead of native JavaScript dialogs.
- Desktop notifications are anchored at the bottom of the left sidebar; mobile toast placement is unchanged.
- Mobile admin lists use explicit custom scrollbar styling; mobile bulk-download button remains full width and settings avatar is larger.


Для установки v13.4 на Sweb используйте `INSTALL_UPDATE_V13_4_RU.md`; результаты проверок и ограничения перечислены в `QA_V13_4_RU.md`.


## v13.5 — desktop/mobile fixes

- Добавлено групповое уведомление о принятии загруженных файлов.
- Desktop unread indicator, кнопка «Прочитать все» в контенте уведомлений, более мягкий breadcrumb blur.
- Исправлены FAQ/admin hover, таймер удаления, окно активации ключа, выбор темы и позиция preview badge.
- Preview-настройки не сохраняются в localStorage до явного сохранения; desktop loading overlay стабилизирован.
- Для обновления используйте `INSTALL_UPDATE_V13_5_RU.md`; SQL-миграции и обновление Python worker не требуются.


## Режимы браузера (v13.10.20)

- `telegram-webapp` — запуск с Telegram `initData`, прежние `.html` URL и WebApp-обвязка.
- `mobile-browser` — обычный браузер телефона/планшета, мобильный интерфейс по `/m/...`.
- `desktop-browser` — обычный браузер компьютера, desktop-интерфейс по существующим чистым URL.

`/api.php` остаётся стабильной точкой входа. Каталог `/api/` запрещён для прямого HTTP-доступа, но PHP подключает расположенные там модули внутренне.


## Покупательский доступ и браузерная авторизация

- Для покупателей добавлена административная настройка обязательной подписки. По умолчанию она включена; при отключении аккаунты без назначенной роли автоматически переводятся в `buyer` при входе через Telegram, чтобы новые покупатели могли пользоваться каталогом без ключа. Существующие роли `seller` и `admin` не меняются. Важно: выключение этой настройки открывает регистрацию покупательских аккаунтов для всех вошедших через Telegram пользователей без назначенной роли.
- На главной странице покупателя при отключённой подписке отображается статус доступа без срока действия; карточка оставшихся дней скрывается. Страница подписки превращается в информационную страницу с доступными возможностями и пояснением, что ключ не нужен.
- На странице входа в обычном браузере уменьшен интервал между описанием и кнопкой Telegram. Диагностика входа показывается общим всплывающим уведомлением над карточкой авторизации; мобильный вариант получает отдельную тень для контраста.
- Изменения используют существующую таблицу `app_settings`; SQL-миграция и обновление Python Worker не требуются.
