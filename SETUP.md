# SETUP — Basalt Perfume Web

Документ описывает настройку **web-ветки**. Он отделяет подтверждённые параметры исходников от тех, которые нужно снять с действующего Sweb-хоста. Точная production-версия PHP, Apache, MySQL/MariaDB и cron в переданном архиве не зафиксирована, поэтому ниже не выдаются предположения за факты.

## 1. Что входит в web-ветку

- Telegram Mini App и мобильный браузер: `public_html/mobile/` (мобильный браузер использует маршруты `/m/...`).
- Desktop browser UI: `public_html/desktop/` (маршруты `/home`, `/prices` и т. д.).
- Общий PHP API: стабильная точка входа `public_html/api.php`; обработчики — `public_html/api/handlers/`, общие PHP-модули — `public_html/api/lib/`.
- Общая БД web и bot: MySQL/MariaDB; web использует PDO, Python worker — `aiomysql`.
- Private Python worker и парсер: `private/basalt-site-worker/`.
- Cron entrypoint: `public_html/scripts/web_upload_worker.py`.
- Cloudflare Worker: `public_html/telegram-oidc-relay/worker.js` — только Telegram OIDC code exchange для browser login. Он не обрабатывает прайс-листы и не заменяет Python worker.

Бот остаётся точкой входа в Telegram и открывает Mini App. Для скачивания, обработки, ZIP-сборки или выдачи прайс-листов бот не нужен.

## 2. BotFather

### 2.1 Создать или проверить бота

1. Откройте официальный `@BotFather` в Telegram.
2. Выполните `/newbot` (если бот ещё не создан), задайте display name и уникальный username, заканчивающийся на `bot`.
3. Сохраните username и bot token в менеджере секретов. Токен не коммитить, не помещать в HTML/JS и не отправлять в issue.
4. Для уже существующего бота используйте `/mybots`, выберите нужного бота и проверьте его настройки.

### 2.2 Настроить запуск Mini App

В BotFather откройте настройки бота и настройте Main Mini App (либо Menu Button, если используется кнопка меню) на HTTPS URL сайта. Для текущей структуры Mini App URL — корневой URL сайта или явно настроенный URL `index.html`, например `https://YOUR_DOMAIN/index.html`. Проверяйте фактический URL из `WEBAPP_URL` и не подменяйте production-домен локальным.

Если используете Menu Button, настройте текст кнопки и Web App URL через соответствующий пункт BotFather (`/setmenubutton` доступен для настройки menu button). Для Main Mini App используйте пункт настройки Main App в профиле бота.

### 2.3 Токен и отсутствие bot runtime

- `BOT_TOKEN` хранится только в серверном `config/database.php`/переменных окружения, если серверный код использует его для Telegram API.
- В web-ветке нет Telegram polling/webhook bot process.
- Не настраивайте для web-ветки отдельный постоянно работающий bot service, если не подключаете отдельную bot-ветку.
- Скачивание файлов выполняется браузером/Telegram WebView напрямую с PHP-сайта; bot не пересылает документы.

### 2.4 Telegram Login / OIDC для обычного браузера

Это отдельная настройка от открытия Mini App:

1. В BotFather → Login Widget / Telegram Login настройте Trusted Origin `https://YOUR_DOMAIN`.
2. Добавьте Redirect URI **точно** `https://YOUR_DOMAIN/telegram-login-callback.html`.
3. Signing Algorithm оставить `RS256 (Default)`.
4. Сохраните Client ID и Client Secret. Client Secret нужен только Cloudflare Worker secret; не добавляйте его в PHP или JS.
5. В PHP config заполните `telegram_login_client_id` и `telegram_login_exchange_relay_url`.
6. `config/telegram-jwks.json` — публичные ключи проверки подписи ID token; не заменяйте их секретом.

Для исходного домена проекта в README указан `https://basalt-parfume.shop`; если домен изменён, замените origin и redirect URI в BotFather, Worker и PHP config согласованно.

## 3. Сервер и каталог размещения

### 3.1 Разделение public/private

DocumentRoot должен указывать на каталог `public_html/`.

Пример рекомендуемой структуры на аккаунте хостинга:

```text
/home/ACCOUNT/
├── public_html/                         # только web-root
│   ├── api.php
│   ├── api/
│   │   ├── bootstrap.php
│   │   ├── router.php
│   │   ├── handlers/
│   │   └── lib/
│   ├── mobile/
│   ├── desktop/
│   ├── assets/
│   └── config/
│       ├── database.example.php
│       └── database.php                 # private credentials; не в git
├── private/
│   └── basalt-site-worker/              # Python package, вне DocumentRoot
│       ├── config.py
│       ├── database/
│       └── services/
├── uploaded_filed/                      # приватные исходные файлы прайсов
└── private-logs/                        # логи worker
```

В архиве встречается историческое написание каталога `uploaded_filed` (именно так, с `filed`). Не переименовывайте существующий каталог без миграции путей в PHP config и worker `.env`.

### 3.2 Apache

Подтверждено исходниками:

- используются `.htaccess`, `mod_rewrite`, `mod_headers`;
- Apache должен разрешать `.htaccess` (`AllowOverride` как минимум для используемых директив);
- PHP должен исполняться в `api.php`, внутренних `api/**/*.php` и `desktop/*.php`; прямой HTTP-доступ к `/api/` запрещён, но PHP должен иметь возможность подключать файлы внутри каталога;
- `DirectoryIndex` настроен на `mobile/index.html`;
- clean routes `/home`, `/prices`, `/settings` и др. переписываются в `desktop/*.php`; маршруты `/m/home`, `/m/prices` и др. — в мобильные HTML-страницы. Ранний `device-mode.js` выбирает один из трёх режимов: Telegram WebApp, мобильный браузер или desktop-браузер.

Рекомендуется Apache 2.4 с PHP-FPM или штатным PHP handler хостинга. Точная версия Apache на production не содержится в архиве. Узнать её:

```bash
apachectl -v
apachectl -M | grep -E 'rewrite|headers|php|proxy_fcgi'
```

На shared hosting команды могут быть недоступны; запросите версии у поддержки Sweb или используйте панель хостинга.

### 3.3 PHP

Исходники используют PDO и cURL; `api.php` проверяет `PHP_VERSION_ID >= 70300` для настройки SameSite cookie, но это **не является полной гарантией совместимости всего приложения с PHP 7.3**. CI и Docker dev-образ настроены на PHP 8.2. Для нового окружения используйте PHP 8.2+ и включите расширения:

- `pdo_mysql` — обязательное соединение с MySQL/MariaDB;
- `curl` — получение Telegram avatar/HTTP интеграции;
- `openssl` — криптографические операции/проверка токенов;
- `json`, `session`, `hash` — обычно входят в стандартную сборку PHP.

Для web upload PHP limits должны быть не меньше 20M согласно README приложения:

```ini
upload_max_filesize = 20M
post_max_size = 20M
```

Уточнить версию и расширения:

```bash
php -v
php -m
php --ri pdo_mysql
php --ri curl
```

Если CLI PHP и PHP сайта используют разные версии, проверяйте версию именно в панели/через временный защищённый phpinfo-файл и сразу удаляйте его после проверки.

### 3.4 SSH

SSH в проекте нужен для первичной установки Python virtualenv/dependencies, диагностики и проверки cron. На Sweb SSH может быть временно включаемым; не делайте приложение зависимым от постоянной интерактивной SSH-сессии. Cron запускает worker самостоятельно.

Проверка:

```bash
ssh ACCOUNT@HOST
whoami
php -v
python3 --version
crontab -l
```

Не храните SSH private key в репозитории.

## 4. MySQL / MariaDB

### 4.1 Подтверждённые требования приложения

- PHP подключается через PDO.
- Python worker подключается через `aiomysql`.
- Используется `utf8mb4`.
- Worker открывает пул соединений с `autocommit=False`, pool max ограничен четырьмя соединениями; по умолчанию `MYSQL_POOL_SIZE=2`.
- В схеме используются транзакции, `InnoDB`, `NOW()`, `JSON`-совместимые поля/текстовые JSON поля и стандартный SQL MySQL/MariaDB.

Точная версия production DB и параметры `sql_mode`, `max_allowed_packet`, `wait_timeout`, `character_set_server`, `collation_server` в переданном web-архиве не зафиксированы. Не считать локальную MariaDB 10.11 из Docker точной копией production.

Снимите фактические параметры на сервере:

```sql
SELECT VERSION() AS db_version,
       @@version_comment AS distribution,
       @@character_set_server AS character_set_server,
       @@collation_server AS collation_server,
       @@sql_mode AS sql_mode,
       @@max_allowed_packet AS max_allowed_packet,
       @@wait_timeout AS wait_timeout;
SHOW ENGINES;
```

### 4.2 Конфигурация PHP

Создайте `public_html/config/database.php` на сервере на основе `database.example.php`. Заполните как минимум:

- `db_host`, `db_port`, `db_name`, `db_user`, `db_pass`;
- `bot_token`, `bot_username`, `admin_ids`, `developer_username` — если требуются соответствующими серверными функциями;
- `site_url`, `webapp_url`;
- `price_list_storage_dir` — существующий legacy storage path;
- `web_upload_storage_dir` — тот же абсолютный каталог, что `UPLOAD_STORAGE_DIR` в worker `.env`;
- `key_encryption_secret` — длинный случайный секрет; не менять без понимания последствий для уже зашифрованных значений.

Пользователю MySQL выдавайте доступ только к нужной БД и необходимые CRUD/DDL privileges для штатных админских операций/миграций. Не используйте root credentials в PHP.

### 4.3 Миграции

Миграции лежат в `public_html/migrations/` и применяются вручную через phpMyAdmin/CLI по инструкции соответствующего релиза. Миграция `009_cleanup_orphan_user_favorites.sql` однократно удаляет старые избранные записи, которые больше не связаны с существующими товарами и прайс-листами. CI проверяет нумерацию и наличие файлов, но **не выполняет их**. Перед применением:

1. сделать полный dump БД;
2. проверить уже существующую схему;
3. применить только отсутствующие миграции в возрастающем порядке;
4. проверить таблицы/индексы и основные сценарии.

Не запускать migration directory повторно вслепую. Bot-ветка может иметь собственные SQL миграции; этот web-репозиторий не пытается управлять ими.

## 5. Python Worker и Cron

### 5.1 Установка приватного пакета

Путь пакета из исходной документации: `/home/<ACCOUNT>/private/basalt-site-worker/`. Он должен быть вне DocumentRoot. Создайте virtualenv и установите зависимости:

```bash
cd /home/<ACCOUNT>/private/basalt-site-worker
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

`requirements.txt` включает `aiomysql`, `python-dotenv`, `openpyxl`, `xlrd`. Worker использует синтаксис Python 3.10+; для нового окружения рекомендуется Python 3.11 или 3.12 (эти версии покрыты CI).

Создайте `/home/<ACCOUNT>/private/basalt-site-worker/.env`:

```dotenv
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=DB_USER
MYSQL_PASSWORD=REPLACE_WITH_DB_PASSWORD
MYSQL_DATABASE=DB_NAME
MYSQL_POOL_SIZE=2
MYSQL_POOL_MINSIZE=1
MAX_CONCURRENT_FILES=1
MAX_FILE_SIZE_MB=20
UPLOAD_STORAGE_DIR=/home/ACCOUNT/uploaded_filed
WORKER_LOG_DIR=/home/ACCOUNT/private-logs
LOG_LEVEL=INFO
```

Установите права на `.env` ограниченно (например, `chmod 600`). PHP user и cron user должны иметь нужный доступ к storage согласно модели аккаунта Sweb.

### 5.2 Cron

Скрипт `public_html/scripts/web_upload_worker.py` — one-shot worker. Его запускают периодически; он блокирует параллельный запуск через `flock`, проверяет очередь, обрабатывает не более доступной работы за один запуск и завершает процесс.

Пример cron (раз в минуту; поправьте ACCOUNT и путь к PHP web root):

```cron
* * * * * /home/ACCOUNT/private/basalt-site-worker/.venv/bin/python /home/ACCOUNT/public_html/scripts/web_upload_worker.py >> /home/ACCOUNT/private-logs/web-upload-cron.log 2>&1
```

Проверка без захвата заданий:

```bash
BASALT_WORKER_ROOT=/home/ACCOUNT/private/basalt-site-worker \
/home/ACCOUNT/private/basalt-site-worker/.venv/bin/python \
/home/ACCOUNT/public_html/scripts/web_upload_worker.py --check
```

Проверить cron:

```bash
crontab -l
```

Не запускать worker постоянно через Telegram-бота. Это отдельный Python процесс по cron, не bot handler.

## 6. Cloudflare Worker — Telegram OIDC relay

В web-репозитории `public_html/telegram-oidc-relay/worker.js` — отдельный edge relay для browser login. Он не является worker обработки прайсов.

1. Cloudflare Dashboard → Workers & Pages → Create Worker.
2. Назовите, например, `basalt-telegram-oidc-relay`.
3. Загрузите содержимое `worker.js` и Deploy.
4. В Settings → Variables and Secrets добавьте Variables:
   - `TELEGRAM_CLIENT_ID` — Client ID из BotFather;
   - `ALLOWED_ORIGIN` — `https://YOUR_DOMAIN` без завершающего `/`;
   - `ALLOWED_REDIRECT_URI` — `https://YOUR_DOMAIN/telegram-login-callback.html`.
5. Добавьте Secret `TELEGRAM_CLIENT_SECRET` — только в Worker Secrets.
6. Укажите Worker URL в `telegram_login_exchange_relay_url` PHP config.
7. В BotFather должны совпадать Trusted Origin, Redirect URI и RS256.

Worker принимает только POST и OPTIONS с точным разрешённым Origin. GET должен возвращать `method_not_allowed`; это ожидаемо. Не включайте логирование body запроса: там одноразовый authorization code и PKCE verifier.

## 7. Проверка фактических версий production

Сохраните вывод в приватном эксплуатационном паспорте, не в публичном issue:

```bash
php -v
php -m
apachectl -v
python3 --version
crontab -l
```

SQL:

```sql
SELECT VERSION(), @@version_comment, @@character_set_server,
       @@collation_server, @@sql_mode, @@max_allowed_packet;
```

Инвентаризация:

- Sweb тариф/тип хостинга и DocumentRoot;
- PHP handler (Apache module или PHP-FPM), PHP CLI version;
- включённые Apache modules (`rewrite`, `headers`);
- SSH доступность/период включения;
- timezone cron и сервера;
- MySQL host/port (без пароля), DB engine/version;
- абсолютные пути private worker, storage и logs;
- Cloudflare Worker name, URL, deployed date/version (без secret values).
