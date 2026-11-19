# Basalt Perfume — Web branch

Репозиторий содержит **только web-часть** Basalt Perfume: Telegram Mini App (mobile HTML), browser/desktop оболочку (PHP), общий PHP API, приватный Python Worker обработки прайс-листов и Cloudflare Worker для Telegram OIDC relay. Исходники Telegram-бота в этот репозиторий не входят.

## Архитектура

```text
Telegram client ──opens──> public_html/mobile/*.html ─┐
Mobile browser ──opens──> public_html/mobile/*.html ─┤
Browser ──────────opens──> public_html/desktop/*.php ├─> public_html/api.php → api/handlers + api/lib → MySQL/MariaDB
                                                     │
Private uploaded_filed/ <── PHP upload/download ─────┘
          │
          └── cron ─> public_html/scripts/web_upload_worker.py
                         └─> private/basalt-site-worker (Python parser)

Browser Telegram OIDC ─> Cloudflare Worker (telegram-oidc-relay/worker.js)
                       └─> oauth.telegram.org/token
```

- `public_html/mobile/` — мобильная оболочка, используемая Telegram WebApp и отдельным режимом мобильного браузера.
- `public_html/desktop/` — PHP-оболочка desktop-браузера.
- Обычный mobile browser перенаправляется на `/m/...`; Telegram WebApp продолжает использовать сохранённые `.html` URL.
- `public_html/assets/js/core/device-mode.js` — раннее разделение режимов `telegram-webapp`, `mobile-browser` и `desktop-browser`.
- `public_html/api.php` — стабильная точка входа; обработчики находятся в `public_html/api/handlers/`, общие функции — в `public_html/api/lib/`.
- `public_html/migrations/` — SQL-миграции web-части.
- `public_html/scripts/web_upload_worker.py` — one-shot cron worker очереди загрузок сайта.
- `private/basalt-site-worker/` — приватный Python-парсер и worker-конфигурация; не размещать в DocumentRoot.
- `public_html/telegram-oidc-relay/worker.js` — Cloudflare Worker для обмена Telegram OIDC authorization code.

## Быстрый старт для разработки

Требования: Docker Engine + Docker Compose plugin. Локальная конфигурация намеренно использует тестовую MariaDB и локальные пароли; **не переносите их на production**.

```bash
cp .env.example .env
make docker-up
```

Откройте `http://localhost:8080`. Для запуска локального Python worker (профиль отдельный):

```bash
docker compose --profile worker up --build worker
```

Пустая локальная БД не содержит бизнес-таблиц. Для полноценного сценария импортируйте согласованный schema/catalog dump в локальную БД, затем примените только отсутствующие миграции. Не импортируйте production dump в публичный или общий dev-контур.

## Разработка и проверки

```bash
python -m venv .venv
. .venv/bin/activate                 # Windows: .venv\\Scripts\\activate
make install
make test
make lint
pre-commit run --all-files
```

GitHub Actions (`.github/workflows/ci.yml`) запускает:

1. `php -l` для всех PHP-файлов;
2. синтаксическую проверку browser JS и Cloudflare Worker;
3. pytest на Python 3.11 и 3.12;
4. `compileall` для Python;
5. pre-commit hooks;
6. Gitleaks secret scan.

CI — это быстрые статические и unit-проверки. Он не подключается к production MySQL, не выполняет реальные Telegram OAuth-запросы, не проверяет Sweb и не заменяет интеграционные тесты после deploy.

## Документация

- [SETUP.md](SETUP.md) — BotFather, сервер, PHP/Apache, MySQL, Cron, SSH, Cloudflare.
- [API.md](API.md) — действия API, методы и модель безопасности.
- [public_html/README.md](public_html/README.md) — исходная документация web-приложения и его URL/страниц.
- [public_html/telegram-oidc-relay/README_RU.md](public_html/telegram-oidc-relay/README_RU.md) — исходная инструкция OIDC relay.

## Важные правила репозитория

- Не коммитить `.env`, `public_html/config/database.php`, токены, пароли, приватные ключи, production dumps и пользовательские файлы.
- `public_html/config/database.example.php` — безопасный шаблон; production `database.php` создаётся отдельно на сервере.
- `uploaded_filed/`, логи и `.venv` находятся вне git и DocumentRoot.
- Бот не участвует в обработке или передаче скачиваемых файлов. WebApp получает подписанную ссылку, а файл выдаёт PHP-сайт напрямую.
- Не запускать SQL-миграции автоматически в CI или при каждом старте приложения.
- Не менять bot-branch из этого web-репозитория.

## Версионирование

CI проверяет текущую ветку web. Изменения общей схемы БД, PHP API или worker должны сопровождаться тестами/документацией и отдельным review. Production deploy на Sweb остаётся отдельным ручным процессом.
