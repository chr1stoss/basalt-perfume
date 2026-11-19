# Basalt Perfume — Admin CLI

**Версия:** `13.10.32-cli.1`  
**Интерфейс:** только командная строка (`argparse`), без GUI и интерактивных окон.  
**База данных:** MySQL / MariaDB.  
**Совместимость:** актуальная схема WebApp v13.10.32, включая очередь подписок `subscription_keys.starts_at` и очередь веб-загрузок `web_upload_site_jobs`.

Утилита подключается напрямую к базе приложения. Ей не нужны исходники других частей проекта: достаточно Python, настроек подключения и доступа к MySQL.

## 1. Установка

Положи `admin-cli.py`, `requirements-admin-cli.txt` и свой `.env` в одну директорию. Для примера конфигурации используй `admin-cli.env.example`.

### Windows PowerShell

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements-admin-cli.txt
Copy-Item admin-cli.env.example .env
notepad .env
```

### Linux / macOS

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements-admin-cli.txt
cp admin-cli.env.example .env
nano .env
```

Требуется Python 3.10 или новее.

Для запуска тестов разработчика:

```bash
pip install -r requirements-dev.txt
pytest -q
```

## 2. Настройка подключения

Для обычных команд используются следующие параметры из `.env`:

```dotenv
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=basalt_perfume
MYSQL_USER=basalt_admin
MYSQL_PASSWORD=пароль
ADMIN_IDS=123456789
KEY_ENCRYPTION_SECRET=существующий_секрет_WebApp
```

`MYSQL_*` — подключение к текущей базе приложения. Пароль может быть пустым, если так настроен MySQL, но обычно у пользователя базы должен быть пароль. `ADMIN_IDS` — список защищённых администраторов через запятую. Первый по порядку ID из этого списка, присутствующий в таблице `users`, автоматически используется для поля администратора в `admin_logs`; его можно переопределить флагом `--actor-id` там, где он поддерживается.

`KEY_ENCRYPTION_SECRET` должен совпадать с выделенным секретом шифрования, который уже использует WebApp. Не генерируй новый и не меняй существующий секрет без отдельного плана миграции: старые сохранённые ключи могут перестать расшифровываться. Значение используется командами `key --reveal` и `generate-keys`.

CLI намеренно не использует старый резервный способ вывода ключа, который строился из других секретов конфигурации при пустом `KEY_ENCRYPTION_SECRET`. Поэтому исторические ключи, созданные при пустом выделенном секрете, могут не расшифроваться через `key --reveal`. Для новых ключей и безопасного показа ключей настрой выделенный секрет, совпадающий с конфигурацией WebApp.

Вместо переменных окружения параметры БД можно задать через глобальные флаги `--db-host`, `--db-port`, `--db-user`, `--db-password`, `--db-name` или через `--php-config public_html/config/database.php`. PHP-конфиг не выполняется: парсер понимает только строковые литералы в `define(...)`, присваиваниях и массивах вида `'db_host' => '...'`. Если в PHP-файле используются `getenv()` или динамические выражения, укажи данные в `.env`.

Глобальные параметры ставятся **до названия команды**:

```bash
python admin-cli.py --env-file .env stats
python admin-cli.py --php-config public_html/config/database.php db-info
python admin-cli.py --db-host db.example.net --db-user admin --db-password 'secret' --db-name basalt_perfume db-info
```

Не передавай пароли прямо в командной строке на общих компьютерах: они могут сохраниться в истории shell или попасть в список процессов. Для рабочих запусков используй `.env` с ограниченными правами доступа.

## 3. Справка

```bash
python admin-cli.py --help
python admin-cli.py --version
python admin-cli.py COMMAND --help
```

Все команды ниже работают с базой, заданной в `.env` или глобальными `--db-*` параметрами.

## 4. Команды администрирования

### Состояние базы и статистика

| Команда | Назначение |
|---|---|
| `db-info` | Проверить соединение, показать версию сервера, выбранную БД, пользователя подключения и серверное время. |
| `stats` | Сводные счётчики пользователей, ключей, активных и ожидающих подписок, прайсов, товаров, строк на проверке и веб-загрузок; показать основные системные настройки. |
| `tables` | Список базовых таблиц, движков, приблизительного числа строк и размера. |

Примеры:

```bash
python admin-cli.py db-info
python admin-cli.py stats
python admin-cli.py tables
```

### Пользователи

| Команда | Аргументы | Назначение |
|---|---|---|
| `users` | `--role admin\|seller\|buyer\|none`, `--status all\|active\|blocked`, `--search TEXT`, `--limit N` | Список и фильтрация профилей. Поиск идёт по Telegram ID, username и имени. |
| `user` | `USER_ID` | Подробности профиля, роль, множитель, блокировка, прайс-листы, ключи/очередь подписок и число актуальных избранных товаров. |
| `favorites` | `USER_ID [--limit N]` | Список актуальных товаров в избранном указанного пользователя. |
| `set-role` | `USER_ID ROLE` | Назначить `admin`, `seller`, `buyer` или `none`. |
| `block` | `USER_ID --reason TEXT` плюс один вариант срока | Временно или бессрочно заблокировать профиль. |
| `unblock` | `USER_ID` | Снять блокировку и очистить причину/срок. |
| `delete-user` | `USER_ID --confirm USER_ID` | Удалить профиль и связанные записи приложения из БД. |

Примеры:

```bash
python admin-cli.py users --status active --limit 100
python admin-cli.py users --role seller --search perfume
python admin-cli.py user 123456789
python admin-cli.py favorites 123456789 --limit 100
python admin-cli.py set-role 123456789 seller
python admin-cli.py block 123456789 --reason "Нарушение правил" --hours 24
python admin-cli.py block 123456789 --reason "Мошенничество" --permanent
python admin-cli.py block 123456789 --reason "Проверка" --until "2026-12-01 18:00"
python admin-cli.py unblock 123456789
python admin-cli.py delete-user 123456789 --confirm 123456789
```

У `block` срок задаётся ровно одним способом: `--until "YYYY-MM-DD HH:MM[:SS]"`, `--minutes N`, `--hours N`, `--days N` или `--permanent`. Причина обязательна; `--details TEXT` задаёт дополнительное описание. Для срока в единицах используется время сервера БД. Дата `--until` интерпретируется во временной зоне сервера приложения/БД.

Защищённые администраторские профили (из `ADMIN_IDS`, таблицы `admins` или с ролью `admin`) нельзя понизить, заблокировать или удалить. Все команды изменения роли, блокировки и удаления дополнительно проверяют цель.

`delete-user` удаляет данные профиля, собственные прайс-листы, подписки и ссылки на избранное из БД. Загруженные файлы и каталоги в файловом хранилище команда **не удаляет**. Сначала сделай резервную копию, если требуется сохранить данные пользователя.

### Подписки и ключи

| Команда | Аргументы | Назначение |
|---|---|---|
| `extend-subscription` | `USER_ID AMOUNT hours\|days\|months` | Продлить действующий сегмент подписки и сдвинуть все будущие сегменты очереди на тот же интервал. |
| `keys` | `--status all\|free\|used\|active\|queued\|expired\|frozen`, `--role buyer\|seller\|admin`, `--limit N` | Показать ключи с фильтрацией. |
| `key` | `KEY_ID [--reveal]` | Показать карточку ключа; `--reveal` расшифровывает код и проверяет HMAC и `key_hash`. |
| `generate-keys` | `--count N`, `--days N`, `--role buyer\|seller\|admin`, `--out-file PATH` | Создать ключи сразу в БД, указав роль при активации и длительность. |
| `disable-key` | `KEY_ID` | Отключить только свободный, ещё не использованный ключ. |
| `assign-key` | `USER_ID KEY_ID` | Назначить свободный ключ пользователю и синхронизировать его роль. |

Примеры:

```bash
python admin-cli.py extend-subscription 123456789 14 days
python admin-cli.py keys --status free --limit 100
python admin-cli.py keys --status queued
python admin-cli.py key 42
python admin-cli.py key 42 --reveal
python admin-cli.py generate-keys --count 20 --days 30 --role seller --out-file ./generated-keys.txt
python admin-cli.py disable-key 42
python admin-cli.py assign-key 123456789 42
```

Лимиты генерации: от 1 до 100 ключей за команду, длительность — от 1 до 3650 дней. Каждый открытый код выводится только в момент создания; повторный просмотр возможен только через `key --reveal`, если секрет шифрования совпадает. Файл `--out-file` создаётся без перезаписи существующего файла с правами `0600` там, где ОС поддерживает POSIX-права. Храни открытые коды как секреты.

`extend-subscription` работает только при наличии `subscription_keys.starts_at` и активной незамороженной подписки. Это поле добавлено миграцией `014_subscription_key_queue.sql`; если миграция ещё не применялась, команда завершится понятной ошибкой. Сам CLI миграции приложения не запускает.

### Прайс-листы, загрузки и ошибки разбора

| Команда | Аргументы | Назначение |
|---|---|---|
| `price-lists` | `--user-id ID`, `--status STATUS`, `--limit N` | Список прайсов с владельцем, размером, количеством исходных строк и товаров. |
| `delete-price-list` | `PRICE_LIST_ID --confirm PRICE_LIST_ID` | Удалить запись прайс-листа из БД и каскадные строки/товары, предварительно очистив связанные избранные товары. |
| `uploads` | `--status pending\|processing\|done\|error`, `--limit N` | Посмотреть текущую очередь веб-загрузок `web_upload_site_jobs`. |
| `retry-upload` | `JOB_ID` | Вернуть задачу со статусом `error`/`failed` в `pending`, сбросить число попыток и ошибку. |
| `errors` | `--user-id ID`, `--limit N` | Просмотр `parse_errors`. |
| `logs` | `--actor ID`, `--action TEXT`, `--limit N` | Просмотр `admin_logs`, в том числе с фильтрацией по администратору и типу действия. |

Примеры:

```bash
python admin-cli.py price-lists --limit 100
python admin-cli.py price-lists --user-id 123456789
python admin-cli.py delete-price-list 77 --confirm 77
python admin-cli.py uploads --status error
python admin-cli.py retry-upload 15
python admin-cli.py errors --limit 100
python admin-cli.py logs --actor 123456789 --limit 100
python admin-cli.py logs --action subscription
```

Удаление прайс-листа удаляет связанные записи БД и товары по FK-каскадам, но не удаляет физический файл с диска. Очередь `web_upload_site_jobs` — очередь текущего сайта; команда `retry-upload` не запускает Worker, а только возвращает задачу в состояние `pending`. Сам Worker должен быть установлен и запущен отдельно по расписанию.

### Настройки приложения и объявления

| Команда | Аргументы | Назначение |
|---|---|---|
| `settings` | — | Показать все записи `app_settings`. |
| `set-setting` | `KEY VALUE` | Создать или изменить конкретную настройку приложения. |
| `browser-access` | `--enable` или `--disable`; `--session-sync keep\|enable\|disable` | Управлять доступом из обычного браузера и синхронизацией сессий. |
| `maintenance` | `--enable` или `--disable`; `--title`, `--message`, `--until` | Включить или завершить технические работы. При включении обязательно указать будущую дату окончания. |
| `announce` | `--title TEXT --message TEXT` | Создать уведомления в центре уведомлений WebApp для пользователей, у которых включены обновления. |

Примеры:

```bash
python admin-cli.py settings
python admin-cli.py set-setting custom_flag 1
python admin-cli.py browser-access --enable --session-sync enable
python admin-cli.py browser-access --disable --session-sync keep
python admin-cli.py maintenance --enable --title "Обновление" --message "Сервис будет недоступен." --until "2026-12-01 18:00"
python admin-cli.py maintenance --disable
python admin-cli.py announce --title "Обновление каталога" --message "Каталог обновлён. Можно продолжать поиск."
```

`announce` пишет только строки в `app_notifications` и не инициирует внешнюю доставку. `browser-access` меняет `browser_access_enabled`; `--session-sync keep` оставляет текущее значение `session_sync_enabled` без изменений.

### Локальная очистка кэша Python

```bash
python admin-cli.py clean-cache
python admin-cli.py clean-cache --root ./some-project
```

Удаляются только каталоги `__pycache__` и `__cache__` внутри указанного корня. Остальные файлы не затрагиваются.

## 5. Перенос MySQL/MariaDB на другой хост

Команда `migrate-db` сохраняет существующий механизм миграции, но теперь запускается исключительно аргументами CLI и конфигурацией `.env`; никаких GUI-экранов или обязательных вводов паролей в терминале нет.

### 5.1. Переменные окружения

Вариант с отдельными параметрами источника и назначения:

```dotenv
OLD_MYSQL_HOST=old-db.example.net
OLD_MYSQL_PORT=3306
OLD_MYSQL_DATABASE=basalt_old
OLD_MYSQL_USER=old_user
OLD_MYSQL_PASSWORD=old_password

NEW_MYSQL_HOST=new-db.example.net
NEW_MYSQL_PORT=3306
NEW_MYSQL_DATABASE=basalt_new
NEW_MYSQL_USER=new_user
NEW_MYSQL_PASSWORD=new_password
```

Допустимые префиксы источника: `OLD_MYSQL_*`, `SOURCE_MYSQL_*` или `MIGRATION_SOURCE_MYSQL_*`. Приоритет именно в этом порядке. Для назначения: `NEW_MYSQL_*`, `TARGET_MYSQL_*`, затем `MYSQL_*`.

Также поддерживается частый сценарий, когда `MYSQL_*` описывает текущую БД-источник, а `NEW_MYSQL_*` — новую БД на другом хосте. В этом случае источник автоматически берётся из `MYSQL_*`, если отдельные переменные источника не заданы.

### 5.2. Сначала только проверка

```bash
python admin-cli.py migrate-db --report-json ./migration-preflight.json
```

Команда подключится к обеим базам, сравнит таблицы и столбцы, оценит совместимость типов, проверит enum-значения, движки и обязательные поля. В режиме без `--apply` данные целевой БД не изменяются. JSON-отчёт содержит найденные различия и число строк по таблицам.

Можно передавать параметры явно, не сохраняя их в `.env` (для паролей всё же рекомендован `.env`):

```bash
python admin-cli.py migrate-db \
  --source-host old-db.example.net --source-port 3306 \
  --source-user old_user --source-database basalt_old \
  --target-host new-db.example.net --target-port 3306 \
  --target-user new_user --target-database basalt_new \
  --report-json ./migration-preflight.json
```

### 5.3. Фактический перенос

Только после успешной проверки и резервного копирования целевой базы:

```bash
python admin-cli.py migrate-db --apply \
  --confirm-target-db basalt_new \
  --report-json ./migration-result.json
```

`--confirm-target-db` должен в точности совпадать с именем целевой базы. Без этого флага запись не начнётся. Источник и назначение дополнительно сравниваются по host, port и имени БД — перенос в ту же базу запрещён.

Размер пакета по умолчанию — 500 строк; диапазон `1..10000`:

```bash
python admin-cli.py migrate-db --batch-size 1000 --report-json ./migration-preflight.json
```

### 5.4. Что именно переносится

Механизм переносит **все базовые таблицы (`BASE TABLE`) и строки источника**:

- таблицы, отсутствующие в назначении, создаются по `SHOW CREATE TABLE` источника;
- в существующие таблицы добавляются отсутствующие столбцы источника;
- строки в одноимённых таблицах назначения заменяются строками источника;
- таблицы, которые есть только в назначении, остаются нетронутыми;
- после копирования сверяется число строк каждой перенесённой таблицы;
- данные копируются пакетами через потоковый курсор источника;
- учитываются совместимые изменения `ENUM`; известное устаревшее значение `user_settings.appearance='system'` преобразуется в актуальное `dark`, если целевая схема его допускает.

Для таблиц с заменяемыми строками требуется транзакционный движок (обычно InnoDB). Проверка останавливает перенос при несовместимых типах, обязательных полях без значения по умолчанию или небезопасном движке.

**Границы переноса:** скрипт переносит базовые таблицы и данные, но не переносит представления (`VIEW`), триггеры, процедуры, функции, события MySQL, пользователей/права сервера и файлы из файлового хранилища. Пользователя БД и GRANT-права на новом хосте нужно подготовить заранее. Целевая база также должна существовать. DDL для новых таблиц/столбцов фиксируется до транзакции копирования данных; если копирование завершится ошибкой, созданные таблицы/столбцы могут остаться, но транзакция строк откатывается. Поэтому до запуска `--apply` обязательно сделай бэкап обеих баз и временно останови запись приложения в источник.

Если требуется перенос буквально всех объектов сервера MySQL, включая routines/triggers/views/users/grants или файлы сайта, дополни этот процесс отдельным `mysqldump`/`mariadb-dump` и переносом файлов; `migrate-db` предназначен для безопасной миграции таблиц приложения.

## 6. Журнал действий и безопасность

Изменяющие команды добавляют запись в `admin_logs`, если таблица существует. В идентификаторе оператора используется `--actor-id` либо первый ID из `ADMIN_IDS`, который найден в `users`. Неизменяющие команды ничего не записывают в журнал.

Разрушающие операции требуют явного подтверждения ID (`delete-user`, `delete-price-list`) либо имени целевой БД (`migrate-db --apply`). Пароли не выводятся. Полный код ключа выводится только по явному `key KEY_ID --reveal` и только после проверки целостности.

Перед запуском на рабочей базе:

1. Сделай резервную копию.
2. Выполни команду просмотра или миграции без флага записи.
3. Проверь целевую базу и точное имя подключения через `db-info` либо параметры `migrate-db`.
4. Для `migrate-db --apply` останови запись приложения на время переноса.
5. После переноса проверь количество строк, `stats`, вход в WebApp и обработку тестового прайс-листа.

## 7. Типовые сценарии

```bash
# Проверить подключение и состояние приложения
python admin-cli.py db-info
python admin-cli.py stats

# Найти пользователя и посмотреть его подписки
python admin-cli.py users --search 123456789
python admin-cli.py user 123456789
python admin-cli.py favorites 123456789 --limit 100

# Продлить активный период с корректным сдвигом очереди
python admin-cli.py extend-subscription 123456789 30 days

# Создать ключи активации продавца
python admin-cli.py generate-keys --count 10 --days 30 --role seller --out-file ./seller-keys.txt

# Проверить проблемные веб-загрузки и вернуть задачу в очередь
python admin-cli.py uploads --status error
python admin-cli.py retry-upload 15

# Включить доступ из браузера и синхронизацию сессий
python admin-cli.py browser-access --enable --session-sync enable
```
