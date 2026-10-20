from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_webapp_api_requests_have_deadline_and_timeout_message():
    api_js = (ROOT / "htdocs/assets/js/core/api.js").read_text(encoding="utf-8")
    app_js = (ROOT / "htdocs/assets/app.js").read_text(encoding="utf-8")
    assert "25000" in api_js
    assert "controller.abort()" in api_js
    assert "api_timeout" in api_js
    assert "Сервер не ответил за 25 секунд" in app_js
    assert "useBootOverviewOnce" in app_js
    index_php = (ROOT / "htdocs/index.php").read_text(encoding="utf-8")
    assert "Приложение не запустилось" in index_php
    assert "30000" in index_php


def test_admin_key_is_available_only_when_decrypted():
    api_php = (ROOT / "htdocs/api.php").read_text(encoding="utf-8")
    app_js = (ROOT / "htdocs/assets/app.js").read_text(encoding="utf-8")
    assert "$keyRow['can_reveal'] = ($fullKey !== null);" in api_php
    assert "$keyRow['key_unavailable_reason']" in api_php
    assert "key_decryption_failed" in app_js
    assert "Восстановить его из хеша нельзя" in app_js
    assert "var alreadyLoadedKey = value.getAttribute('data-raw-key') || '';" in app_js


def test_bot_proxy_is_optional_and_scoped_to_bot_session():
    main_py = (ROOT / "main.py").read_text(encoding="utf-8")
    config_py = (ROOT / "bot/config.py").read_text(encoding="utf-8")
    env_example = (ROOT / ".env.example").read_text(encoding="utf-8")
    assert "AiohttpSession(proxy=settings.bot_proxy or None, timeout=settings.bot_api_timeout)" in main_py
    assert "bot_proxy: str = _read_bot_proxy()" in config_py
    assert "bot_api_timeout: float" in config_py
    assert "raw.startswith('#')" in config_py
    assert "BOT_PROXY=" in env_example


def test_screen_load_failure_is_global_including_settings():
    app_js = (ROOT / "htdocs/assets/app.js").read_text(encoding="utf-8")
    assert "var globalLoadFailure = null;" in app_js
    assert "function renderGlobalLoadError(error)" in app_js
    assert "Все разделы, включая настройки, временно недоступны." in app_js
    assert "if(globalLoadFailure){renderGlobalLoadError(globalLoadFailure);return;}" in app_js
    assert ".catch(function(error){renderGlobalLoadError(error);});" in app_js

def test_external_browser_guard_is_applied_before_app_shell_paints():
    index_php = (ROOT / "htdocs/index.php").read_text(encoding="utf-8")
    css = (ROOT / "htdocs/assets/css/visual-system.css").read_text(encoding="utf-8")
    app_js = (ROOT / "htdocs/assets/app.js").read_text(encoding="utf-8")
    assert "external-open-pending" in index_php
    assert "html.external-open-pending .app-shell" in css
    assert "document.documentElement.classList.remove('external-open-pending')" in app_js


def test_async_screen_fetch_errors_also_lock_all_screens():
    app_js = (ROOT / "htdocs/assets/app.js").read_text(encoding="utf-8")
    assert "}).catch(function(e) { renderGlobalLoadError(e); });" in app_js
    assert "}).catch(function (e) {\n      renderGlobalLoadError(e);\n    });" in app_js


def test_telegram_launch_data_fallback_and_localized_external_footer():
    app_js = (ROOT / "htdocs/assets/app.js").read_text(encoding="utf-8")
    index_php = (ROOT / "htdocs/index.php").read_text(encoding="utf-8")
    assert "function readLaunchInitData()" in app_js
    assert "hashParams.get('tgWebAppData')" in app_js
    assert "initDataUser = JSON.parse(encodedUser)" in app_js
    assert "data-landing-footer" in app_js
    assert "landingFooterText={ru:" in app_js
    assert "Telegram авторизациясы" in app_js
    assert "hash.get('tgWebAppData')" in index_php
    assert __import__('re').search(r'assets/app.js\?v=\d+', index_php)


def test_commented_or_invalid_proxy_does_not_break_startup():
    config_py = (ROOT / "bot/config.py").read_text(encoding="utf-8")
    assert "if not raw or raw.startswith('#')" in config_py
    assert "return ''" in config_py
    assert "BOT_PROXY is invalid; starting without a proxy" in config_py
    assert "os.getenv('BOT_API_TIMEOUT', '12')" in config_py


def test_initial_auth_does_not_wait_for_remote_avatar_services():
    api_php = (ROOT / "htdocs/api.php").read_text(encoding="utf-8")
    current_user = api_php[api_php.index("function current_user("):api_php.index("function subscription_for(")]
    assert "cache_telegram_avatar_from_url($tgId, $sourcePhoto)" not in current_user
    assert "cache_telegram_avatar_from_bot_api($tgId, $config)" not in current_user
    assert "Never call Telegram/CDN from the authentication-critical request" in current_user


def test_bootstrap_failure_logs_safe_diagnostics_to_console():
    app_js = (ROOT / "htdocs/assets/app.js").read_text(encoding="utf-8")
    assert "Basalt WebApp bootstrap failed" in app_js
    assert "httpStatus: globalLoadFailure.httpStatus || null" in app_js
