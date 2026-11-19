# Basalt Perfume

**Basalt Perfume** — веб-приложение для работы с прайс-листами продавцов парфюмерии, формирования общего каталога, поиска товаров и сравнения цен. Я развиваю проект как единую систему с несколькими интерфейсами, общей серверной логикой и общей базой данных.

В приложении предусмотрены каталог и поиск по товарам и брендам, загрузка и обработка прайс-листов, сравнение цен, избранное, уведомления, подписки, ключи активации и административные инструменты.

> **Текущий принцип архитектуры:** Telegram-бот используется как точка входа в Telegram и средство запуска Mini App. Обработка загруженных с сайта файлов, скачивание прайс-листов и выдача файлов выполняются веб-приложением и приватным Python Worker, а не ботом.

## Содержание

- [Структура репозитория](#структура-репозитория)
- [Архитектура](#архитектура)
- [Технологический стек](#технологический-стек)
- [Развёртывание](#развёртывание)
- [Настройка сервера](#настройка-сервера)
- [Настройка базы данных](#настройка-базы-данных)
- [Настройка Telegram и BotFather](#настройка-telegram-и-botfather)
- [Admin CLI](#admin-cli)
- [SQL: установка и обновление схемы](#sql-установка-и-обновление-схемы)
- [Проверки и CI](#проверки-и-ci)
- [Безопасность](#безопасность)
- [Версии и документация](#версии-и-документация)

---

## Структура репозитория

Я разделил GitHub-репозиторий на четыре ветки. Каждая ветка отвечает за отдельную часть проекта.

| Ветка | Назначение | Содержимое |
|---|---|---|
| `main` | Управление проектом и документация | Общая документация, `CHANGELOG.md`, `admin-cli.py`, инструкции по серверу и базе данных |
| `bot` | Настройка Telegram-бота через BotFather | Тексты профиля RU/EN/KZ, логотип и изображение описания. Исходники постоянно работающего bot-процесса в актуальную ветку не входят |
| `sql` | Структура и обновление БД | Упорядоченные миграции, исходные SQL-файлы, диагностические запросы, seed-файлы и полные дампы для новой установки |
| `web` | Основная часть приложения | Mobile и desktop интерфейсы, PHP API, серверная бизнес-логика, приватный Python Worker, тесты, CI и документация по развёртыванию |


Ветка `web` является основной для запуска приложения. Для настройки базы данных используйте материалы `sql`, а для настройки Telegram — материалы `bot`.

## Архитектура

### Клиентские интерфейсы

В `web` поддерживаются три режима работы:

- **Telegram WebApp** — мобильная HTML-оболочка из `public_html/mobile/`.
- **Мобильный браузер** — мобильная оболочка с отдельными маршрутами `/m/...`.
- **Desktop-браузер** — PHP-оболочка из `public_html/desktop/` с чистыми маршрутами `/home`, `/prices`, `/subscription`, `/settings`, `/admin`, `/search`, `/notifications` и `/support`.

Выбор режима выполняется автоматически. Все варианты используют общий PHP API, общую БД и общую серверную бизнес-логику.

### Обработка прайс-листов

```text
Telegram WebApp / Mobile browser / Desktop browser
                         |
                         v
                PHP frontend + API
                         |
             +-----------+-----------+
             |                       |
             v                       v
        MySQL / MariaDB       Private file storage
                                     |
                             web_upload_site_jobs
                                     |
                                     v
                         Cron: web_upload_worker.py
                                     |
                                     v
                         Private Python parser
                                     |
                                     v
                               MySQL
```

Загрузка с сайта создаёт задачу в `web_upload_site_jobs`. Файлы хранятся вне публичного каталога сайта. Cron запускает отдельный Python Worker, который забирает задачи, использует приватный парсер и сохраняет результат в общей базе данных.

Скачивание выполняется непосредственно веб-приложением через PHP. Бот не скачивает файлы из хранилища, не пересылает их пользователям и не является обязательным процессом для работы сайта.

### Авторизация в браузере

Для обычного браузера предусмотрен вход через Telegram OpenID Connect. Обмен одноразового authorization code выполняет отдельный Cloudflare Worker (`telegram-oidc-relay/worker.js`). PHP проверяет ID token и создаёт сессию. `Client Secret` хранится только в Secrets Cloudflare Worker.

Это отдельный механизм от авторизации Telegram Mini App через Telegram WebApp `initData`.

## Технологический стек

| Компонент | Технологии |
|---|---|
| Интерфейсы | HTML, CSS, JavaScript |
| Серверная часть и API | PHP, PDO |
| Основная БД | MySQL / MariaDB, `utf8mb4`, InnoDB |
| Обработка прайс-листов | Python, `aiomysql`, `openpyxl`, `xlrd`, `python-dotenv` |
| Фоновые задачи сайта | Cron и `public_html/scripts/web_upload_worker.py` |
| Браузерная авторизация Telegram | OpenID Connect, PKCE, Cloudflare Worker |
| CLI администрирования | Python, `argparse`, PyMySQL |
| Проверки web-ветки | pytest, PHP lint, JavaScript syntax checks, pre-commit, GitHub Actions |

Я сохраняю текущий стек проекта. Перевод Python Worker на другой язык или замена MySQL/MariaDB не являются частью текущей архитектуры.

---

## Развёртывание

Подробная пошаговая инструкция находится в `SETUP.md` ветки `web`. Ниже приведён общий порядок установки.

1. Подготовить хостинг, домен, PHP, MySQL/MariaDB, Python и Cron.
2. Создать пустую базу данных и отдельного пользователя БД с необходимыми правами.
3. Разместить содержимое ветки `web` в каталоге сайта. Публичный DocumentRoot должен указывать на `public_html/`.
4. Создать серверный `public_html/config/database.php` на основе `public_html/config/database.example.php`. Не перезаписывать его при обновлении сайта.
5. Установить схему БД: для новой БД использовать один полный установочный дамп из ветки `sql`; для существующей — проверить и применить только отсутствующие миграции.
6. Разместить приватный Python-пакет Worker вне DocumentRoot, создать virtualenv, установить зависимости и заполнить `.env`.
7. Настроить Cron для запуска `public_html/scripts/web_upload_worker.py`.
8. Настроить Main Mini App в BotFather. Для обычного браузерного входа отдельно настроить Telegram OIDC и Cloudflare Worker.
9. Проверить вход, каталог, поиск, загрузку, обработку и скачивание тестового прайс-листа.

Рекомендуемая структура каталогов на хостинге:

```text
/home/<user>/
├── public_html/                         # DocumentRoot
│   ├── api.php
│   ├── api/
│   ├── mobile/
│   ├── desktop/
│   ├── assets/
│   ├── config/
│   └── scripts/web_upload_worker.py
├── private/
│   └── basalt-site-worker/              # Python Worker и парсер
├── uploaded_filed/                      # приватные файлы загрузок
└── private-logs/                        # логи Worker
```

В исходниках используется историческое имя каталога `uploaded_filed` (именно `filed`). Не переименовывайте его без одновременного изменения путей в PHP-конфигурации и `.env` Worker.

## Настройка сервера

Точные версии production-сервера в переданном архиве не зафиксированы. Поэтому параметры ниже разделены на рекомендации и значения, которые необходимо заполнить по фактической конфигурации хостинга.

### Параметры окружения

| Параметр | Рекомендация / значение |
|---|---|
| Домен | `https://basalt-parfume.shop` |
| DocumentRoot | `/home/<user>/public_html` |
| Apache | Рекомендуется Apache 2.4; фактическую версию проверить на хостинге |
| PHP | Для нового окружения рекомендуется PHP 8.2 или новее |
| PHP extensions | `pdo_mysql`, `curl`, `openssl`, `json`, `session`, `hash` |
| Python | 3.10 или новее; для развёртывания предпочтительно 3.11/3.12 |
| MySQL / MariaDB | `MySQL 5.7` |
| Cron | Запуск Worker раз в минуту |
| SSH | Используется для установки и диагностики; постоянная интерактивная SSH-сессия приложению не требуется |

CI и Docker-конфигурация web-ветки используют PHP 8.2 и Python 3.11/3.12. Это ориентир тестового окружения, а не подтверждение установленных на production версий.

Для Apache требуются используемые проектом правила `.htaccess`, в том числе `mod_rewrite` и `mod_headers`, а также разрешённый `AllowOverride`.

Для загрузки файлов параметры PHP должны быть не меньше:

```ini
upload_max_filesize = 20M
post_max_size = 20M
```

### PHP-конфигурация

Файл `public_html/config/database.php` создаётся отдельно на сервере на основе `database.example.php`. В нём задаются используемые приложением параметры:

```php
<?php
return [
    'db_host' => '[db_host]',
    'db_port' => 3306,
    'db_name' => '[db_name]',
    'db_user' => '[db_username]',
    'db_pass' => '[db_password]',

    'bot_token' => '[BOT_TOKEN, ЕСЛИ НУЖЕН СЕРВЕРНЫМ ФУНКЦИЯМ]',
    'bot_username' => '[bot_username]',
    'admin_ids' => '[telegram_admin_ids]',

    'site_url' => 'https://[domain]',
    'webapp_url' => 'https://[domain]/',

    'price_list_storage_dir' => '[absolute_path_to_old_storage]',
    'web_upload_storage_dir' => '/home/<user>/uploaded_filed',

    'key_encryption_secret' => '[actual_secret_encrypt_code]',
    'telegram_login_client_id' => '[telegram_client_id]',
    'telegram_login_exchange_relay_url' => '[cloudflare_worker_url]',
];
```

Это схема с заглушками, а не готовый конфигурационный файл для копирования без проверки. Ориентируйтесь на фактические ключи в `public_html/config/database.example.php` текущей ветки `web`.

Не используйте root-пользователя MySQL в PHP. Создайте отдельного пользователя БД и выдайте ему права только на базу приложения. Не публикуйте `database.php`.

### Python Worker

Приватный пакет располагается, например, в `/home/<root>/private/basalt-site-worker/`. Он не должен находиться внутри `public_html/`.

Создайте virtualenv и установите зависимости:

```bash
cd /home/<user>/private/basalt-site-worker
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

Пример `.env` Worker:

```dotenv
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=[db_username]
MYSQL_PASSWORD=[db_password]
MYSQL_DATABASE=[db_name]

MYSQL_POOL_SIZE=2
MYSQL_POOL_MINSIZE=1
MAX_CONCURRENT_FILES=1
MAX_FILE_SIZE_MB=20

UPLOAD_STORAGE_DIR=/home/<user>/uploaded_filed
WORKER_LOG_DIR=/home/<user>/private-logs
LOG_LEVEL=INFO
```

`UPLOAD_STORAGE_DIR` должен совпадать с `web_upload_storage_dir` в PHP-конфигурации. Каталоги хранения и логов должны быть доступны PHP и Python Worker на чтение/запись в соответствии с назначением.

Проверка Worker:

```bash
BASALT_WORKER_ROOT=/home/<user>/private/basalt-site-worker \
/home/<user>/private/basalt-site-worker/.venv/bin/python \
/home/<user>/public_html/scripts/web_upload_worker.py --check
```

Пример Cron:

```cron
* * * * * /home/<user>/private/basalt-site-worker/.venv/bin/python /home/<user>/public_html/scripts/web_upload_worker.py >> /home/<user>/private-logs/web-upload-cron.log 2>&1
```

Путь и имя учётной записи необходимо заменить на фактические. Перед включением Cron сначала выполните `--check`.

## Настройка базы данных

### Требования

- PHP подключается к MySQL/MariaDB через PDO.
- Python Worker подключается через `aiomysql`.
- Используется кодировка `utf8mb4`.
- Основные таблицы используют транзакционный движок InnoDB.
- Web- и bot-компоненты используют общую базу данных.

Точная production-версия MySQL/MariaDB и серверные параметры в архивах не зафиксированы. Их необходимо проверить на хостинге:

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

### Новая база

1. Создайте пустую БД с кодировкой `utf8mb4`.
2. В phpMyAdmin выберите эту БД.
3. В ветке `sql`, в `03_FULL_INSTALL_DUMPS/`, выберите ровно один дамп:
   - `Basalt_Perfume_FULL_INSTALL_WITH_BRANDS.sql` — схема с брендами и алиасами;
   - `Basalt_Perfume_FULL_INSTALL_EMPTY_BRANDS.sql` — схема с пустыми таблицами брендов и алиасов.
4. Импортируйте выбранный файл.
5. Настройте PHP и Worker на подключение к созданной БД.

Полные дампы содержат `DROP TABLE IF EXISTS`. Они предназначены для новой пустой БД и не должны импортироваться поверх действующей production-БД.

### Существующая база

1. Сделайте полный резервный дамп.
2. Проверьте фактические таблицы и структуру.
3. Откройте `01_ORDERED_MIGRATIONS/` ветки `sql`.
4. Сравните файлы с уже применёнными изменениями и выполните только отсутствующие миграции по порядку.
5. После каждой группы изменений проверьте схему и основные сценарии приложения.

В текущем пакете находятся 14 упорядоченных миграций `001`–`014`. Некоторые изменения ранее могли быть применены отдельными миграциями bot- или web-компонента, поэтому повторно запускать всю цепочку вслепую нельзя.

Миграции применяются вручную через phpMyAdmin или SQL-клиент. CI не выполняет production-миграции автоматически.

## Настройка Telegram и BotFather

Ветка `bot` предназначена для настройки профиля и запуска WebApp из Telegram. В текущем составе ветки находятся `botfather_i18n.json`, `logo.jpg` и `description_pic.png`.

### Создание или проверка бота

1. Откройте официальный `@BotFather`.
2. Для нового бота выполните `/newbot`, задайте отображаемое имя и уникальный username, оканчивающийся на `bot`.
3. Для существующего бота используйте `/mybots` и выберите нужного бота.
4. Сохраните токен в менеджере секретов. Не добавляйте токен в Git, HTML, JavaScript или публичные issue.

### Настройка Mini App

1. В настройках нужного бота откройте настройку Main Mini App.
2. Укажите HTTPS URL приложения, например `https://[ВАШ_ДОМЕН]/index.html`.
3. Убедитесь, что URL соответствует текущему `WEBAPP_URL` и открывается снаружи.
4. При необходимости отдельно настройте Menu Button через `/setmenubutton`, указав HTTPS URL WebApp.

### Обычный вход через Telegram Account

Для авторизации из обычного браузера настройте Telegram Login / OIDC отдельно от Main Mini App:

1. В BotFather задайте Trusted Origin `https://[domain]`.
2. Добавьте Redirect URI `https://[domain]/telegram-login-callback.html`.
3. Оставьте алгоритм подписи `RS256`.
4. Сохраните Client ID и Client Secret.
5. Поместите `TELEGRAM_CLIENT_SECRET` только в Secrets Cloudflare Worker.
6. Заполните `telegram_login_client_id` и `telegram_login_exchange_relay_url` в серверной PHP-конфигурации.
7. Проверьте совпадение домена, Trusted Origin и Redirect URI.

`Client Secret` нельзя помещать в PHP-файл, HTML, JavaScript или Git. Публичный `config/telegram-jwks.json` используется для проверки подписи и не заменяет секрет.

В актуальной ветке `web` нет постоянно работающего процесса Telegram polling/webhook. Бот не нужен для фоновой обработки прайс-листов или передачи файлов пользователям.

## Admin CLI

Ветка `main` содержит `admin-cli.py` — отдельную CLI-утилиту для управления данными приложения напрямую в MySQL/MariaDB. Утилите не требуется запускать WebApp или bot-процесс.

**Версия CLI:** `13.10.32-cli.1`  
**Требование:** Python 3.10 или новее.

Установка зависимостей:

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

python -m pip install --upgrade pip
python -m pip install "PyMySQL>=1.1,<2.0" "python-dotenv>=1.0,<2.0"
```

`python-dotenv` необязателен: скрипт содержит резервный разбор `.env`. Основная зависимость для подключения к БД — PyMySQL.

Создайте `.env` рядом с `admin-cli.py`:

```dotenv
MYSQL_HOST=[db_host]
MYSQL_PORT=3306
MYSQL_DATABASE=[db_name]
MYSQL_USER=[db_username]
MYSQL_PASSWORD=[db_password]

ADMIN_IDS=[telegram_admin_ids]
KEY_ENCRYPTION_SECRET=[actual_secret_encrypt_code]
```

`KEY_ENCRYPTION_SECRET` должен в точности совпадать с выделенным секретом, используемым WebApp для шифрования ключей активации. Не генерируйте новое значение для уже работающей базы без отдельного плана миграции.

Примеры:

```bash
python admin-cli.py --env-file .env db-info
python admin-cli.py stats
python admin-cli.py users --role seller --limit 100
python admin-cli.py user 123456789
python admin-cli.py favorites 123456789 --limit 100
python admin-cli.py keys --status queued
python admin-cli.py uploads --status error
python admin-cli.py browser-access --enable --session-sync enable
```

Глобальные параметры подключения указываются перед командой. Можно использовать `--db-host`, `--db-port`, `--db-user`, `--db-password`, `--db-name` или `--php-config public_html/config/database.php`. Не передавайте пароль в командной строке на общих компьютерах: он может остаться в истории shell или быть виден в списке процессов.

Основные группы команд:

- состояние БД и статистика: `db-info`, `stats`, `tables`;
- пользователи: `users`, `user`, `favorites`, `set-role`, `block`, `unblock`, `delete-user`;
- подписки и ключи: `extend-subscription`, `keys`, `key`, `generate-keys`, `disable-key`, `assign-key`;
- прайс-листы и очередь загрузок: `price-lists`, `delete-price-list`, `uploads`, `retry-upload`, `errors`, `logs`;
- настройки: `settings`, `set-setting`, `browser-access`, `maintenance`, `announce`;
- служебные операции: `clean-cache`, `migrate-db`.

Справка по конкретной команде доступна через:

```bash
python admin-cli.py --help
python admin-cli.py <command> --help
```

### Перенос базы через `migrate-db`

Сначала запускайте проверку без записи:

```bash
python admin-cli.py migrate-db --report-json ./migration-preflight.json
```

После резервного копирования обеих баз и проверки отчёта перенос запускается с явным подтверждением имени целевой БД:

```bash
python admin-cli.py migrate-db --apply \
  --confirm-target-db [exact_target_db_name] \
  --report-json ./migration-result.json
```

Перед фактическим переносом необходимо остановить запись приложения в исходную БД. CLI переносит базовые таблицы и строки, но не переносит VIEW, триггеры, процедуры, функции, события MySQL, серверных пользователей и GRANT-права, а также файлы из файлового хранилища. Целевая БД и пользователь с нужными правами должны быть подготовлены заранее.

## SQL: установка и обновление схемы

Состав ветки `sql`:

- `01_ORDERED_MIGRATIONS/` — 14 рекомендуемых инкрементальных миграций `001`–`014`;
- `02_ORIGINAL_SQL/BOT/` — исходные bot SQL, миграции, дампы, legacy-файлы, диагностика и seeds;
- `02_ORIGINAL_SQL/WEB/` — SQL-файлы web-части;
- `03_FULL_INSTALL_DUMPS/` — два объединённых дампа для новой базы.

В упорядоченную цепочку входят изменения языка, уведомлений, шифрования ключей, меню, ролей и множителей, избранного, очередей уведомлений, размеров товаров, ключей активации, приватности продавца, очереди удаления пользователя, browser access, web uploads, очереди загрузок сайта и очереди подписок.

Полные дампы и миграции имеют разные назначения. Дамп применяется к новой пустой БД; миграции — к существующей схеме после проверки. Не используйте исходные legacy-файлы как альтернативную последовательность без сравнения с текущей БД.

## Проверки и CI

Ветка `web` содержит GitHub Actions workflow, тесты и инструменты разработки. По документации ветки CI выполняет:

1. PHP syntax check (`php -l`);
2. проверку синтаксиса browser JavaScript и Cloudflare Worker;
3. pytest на Python 3.11 и 3.12;
4. `compileall` для Python;
5. pre-commit hooks;
6. Gitleaks secret scan.

Локальные команды:

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

python -m pip install -r requirements-dev.txt
make test
make lint
pre-commit run --all-files
```

CI выполняет статические проверки и тесты, но не подключается к production MySQL, не выполняет реальные Telegram OAuth-запросы и не проверяет Sweb. После развёртывания необходимо отдельно проверить сайт, авторизацию, обработку и скачивание тестового прайс-листа.

## Безопасность

- Не коммитьте `.env`, `public_html/config/database.php`, пароли MySQL, Telegram bot token, Telegram Client Secret, приватные SSH-ключи и реальные пользовательские логи.
- Не размещайте `private/basalt-site-worker/`, `.venv`, `uploaded_filed/` и приватные логи внутри DocumentRoot.
- Не помещайте секреты в HTML или JavaScript: всё, что отправлено браузеру, пользователь может увидеть через DevTools.
- Не публикуйте production-дампы и пользовательские данные.
- Не запускайте полный комплект SQL-миграций без сверки с текущей схемой.
- Не заменяйте действующий `database.php` при обновлении web-файлов.
- Не меняйте `KEY_ENCRYPTION_SECRET` без плана миграции уже сохранённых ключей.
- Перед SQL-изменениями и deploy создавайте резервную копию сайта и БД.

**Важное замечание перед публикацией архивов:** в переданном локальном архиве обнаружены файлы с именами `private/basalt-site-worker/.env` и `public_html/config/database.php`. Я не включаю их содержимое в документацию. Перед отправкой `web` в публичную ветку необходимо убедиться, что эти файлы исключены из Git и заменить их безопасными шаблонами. Если реальные секреты уже попадали в публичный репозиторий, их необходимо отозвать или сменить.

## Версии и документация

- Admin CLI в ветке `main` помечен версией `13.10.32-cli.1`.
- В `public_html/README.md` ветки `web` сохранена метка `v13.10.20`, тогда как README Admin CLI указывает совместимость с WebApp `v13.10.32`. Я не объединяю эти обозначения в один номер релиза без подтверждения единой версии исходников.
- Ветка `web`: `README.md`, `SETUP.md`, `API.md`, `HOST-INVENTORY.template.md`.
- Ветка `sql`: собственный `README.md` с правилами импорта дампов и применения миграций.
- Ветка `bot`: `botfather_i18n.json` и графические материалы профиля.
- История изменений проекта: [`CHANGELOG.md`](CHANGELOG.md).