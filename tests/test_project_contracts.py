from pathlib import Path
import re
import pytest

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public_html"


@pytest.mark.static
def test_api_rejects_non_post_requests_for_regular_api():
    source = (PUBLIC / "api" / "router.php").read_text(encoding="utf-8")
    assert "API принимает только POST-запросы" in source
    assert "method_not_allowed" in source


@pytest.mark.static
def test_signed_downloads_are_time_limited_and_signed():
    source = (PUBLIC / "api" / "lib" / "downloads.php").read_text(encoding="utf-8") + (PUBLIC / "api" / "router.php").read_text(encoding="utf-8")
    assert "hash_hmac" in source
    assert "expires_in" in source
    assert "download_token" in source


@pytest.mark.static
def test_worker_uses_private_storage_path_validation():
    source = (PUBLIC / "scripts" / "web_upload_worker.py").read_text(encoding="utf-8")
    assert "validate_upload_path" in source
    assert "relative_to(storage_root)" in source
    assert "never starts a Telegram client" in source


@pytest.mark.static
def test_migrations_have_unique_sequential_prefixes():
    migration_dir = PUBLIC / "migrations"
    files = sorted(migration_dir.glob("*.sql"))
    prefixes = [int(re.match(r"^(\d+)_", f.name).group(1)) for f in files]
    assert prefixes == list(range(len(files)))
    assert len({f.name for f in files}) == len(files)


@pytest.mark.static
def test_apache_rewrites_include_both_web_shells():
    htaccess = (PUBLIC / ".htaccess").read_text(encoding="utf-8")
    assert "desktop/index.php" in htaccess
    assert "mobile/index.html" in htaccess
    assert "RewriteEngine On" in htaccess


@pytest.mark.static
def test_database_example_contains_no_real_credentials():
    config = (PUBLIC / "config" / "database.example.php").read_text(encoding="utf-8")
    assert "YOUR_DATABASE_PASSWORD" in config
    assert "PASTE_TELEGRAM_BOT_TOKEN" in config
    assert "YOUR_DATABASE_NAME" in config



@pytest.mark.static
def test_worker_file_size_limit_is_configured():
    config = (ROOT / "private" / "basalt-site-worker" / "config.py").read_text(encoding="utf-8")
    worker = (PUBLIC / "scripts" / "web_upload_worker.py").read_text(encoding="utf-8")
    assert 'max_file_size_mb: int = _int_env("MAX_FILE_SIZE_MB", 20' in config
    assert "settings.max_file_size_mb" in worker


@pytest.mark.static
def test_favorites_are_cleaned_on_price_list_delete_and_replacement():
    api = (PUBLIC / "api" / "handlers" / "price_lists.php").read_text(encoding="utf-8")
    worker = (PUBLIC / "scripts" / "web_upload_worker.py").read_text(encoding="utf-8")
    assert "DELETE f FROM user_favorites f INNER JOIN products p ON p.id=f.product_id INNER JOIN source_rows sr ON sr.id=p.source_row_id WHERE sr.price_list_id=?" in api
    assert "DELETE f FROM user_favorites f " in worker
    assert "WHERE sr.price_list_id IN (" in worker
    assert worker.index("DELETE f FROM user_favorites f") < worker.index("DELETE FROM price_lists WHERE owner_tg_id=%s AND id IN (")


@pytest.mark.static
def test_favorites_badge_counts_only_products_in_existing_price_lists():
    api = (PUBLIC / "api" / "handlers" / "account.php").read_text(encoding="utf-8")
    assert "INNER JOIN products p ON p.id=f.product_id INNER JOIN source_rows sr ON sr.id=p.source_row_id INNER JOIN price_lists pl ON pl.id=sr.price_list_id WHERE f.user_tg_id=?" in api


@pytest.mark.static
def test_orphan_favorites_cleanup_migration_is_present():
    migration = (PUBLIC / "migrations" / "009_cleanup_orphan_user_favorites.sql").read_text(encoding="utf-8")
    assert "DELETE f" in migration
    assert "LEFT JOIN products AS p" in migration
    assert "LEFT JOIN source_rows AS sr" in migration
    assert "LEFT JOIN price_lists AS pl" in migration
    assert "WHERE p.id IS NULL OR sr.id IS NULL OR pl.id IS NULL" in migration


@pytest.mark.static
def test_price_list_delete_cleans_favorites_in_the_same_transaction():
    api = (PUBLIC / "api" / "handlers" / "price_lists.php").read_text(encoding="utf-8")
    action = api[api.index("if ($action === 'delete_file') {"):]
    assert "$pdo->beginTransaction();" in action
    assert "FOR UPDATE" in action
    cleanup_at = action.index("DELETE f FROM user_favorites f")
    delete_at = action.index("DELETE FROM price_lists WHERE id=? AND owner_tg_id=?")
    commit_at = action.index("$pdo->commit();")
    assert cleanup_at < delete_at < commit_at


@pytest.mark.static
def test_device_mode_detector_splits_telegram_mobile_and_desktop():
    detector = (PUBLIC / "assets" / "js" / "core" / "device-mode.js").read_text(encoding="utf-8")
    assert "telegram-webapp" in detector
    assert "mobile-browser" in detector
    assert "desktop-browser" in detector
    assert "userAgentData" in detector
    assert "tgWebAppData" in detector
    htaccess = (PUBLIC / ".htaccess").read_text(encoding="utf-8")
    assert "^m/home" in htaccess and "mobile/index.html" in htaccess


@pytest.mark.static
def test_screen_loading_overlay_is_removed_from_dom_after_hide():
    app = (PUBLIC / "assets" / "app.js").read_text(encoding="utf-8")
    assert "overlay.parentNode.removeChild(overlay)" in app
    assert "overlay._bpRemovalTimer" in app
    assert "function hideScreenLoading()" in app


@pytest.mark.static
def test_api_is_split_into_protected_domain_handlers():
    entry = (PUBLIC / "api.php").read_text(encoding="utf-8")
    deny = (PUBLIC / "api" / ".htaccess").read_text(encoding="utf-8")
    assert "api/bootstrap.php" in entry and "api/router.php" in entry
    assert "Require all denied" in deny
    for handler in ("session.php", "account.php", "uploads.php", "downloads.php", "price_lists.php", "catalog.php", "favorites.php", "notifications.php", "settings.php", "admin.php"):
        assert (PUBLIC / "api" / "handlers" / handler).is_file()


@pytest.mark.static
def test_session_sync_preserves_three_interface_modes():
    auth = (PUBLIC / "api" / "lib" / "auth.php").read_text(encoding="utf-8")
    app = (PUBLIC / "assets" / "app.js").read_text(encoding="utf-8")
    assert "mobile_browser" in auth and "telegram_webapp" in auth
    assert "platform:initData?'telegram_webapp':(browserMobileMode?'mobile_browser':'desktop')" in app


@pytest.mark.static
def test_account_overview_handler_remains_inside_php():
    account = (PUBLIC / "api" / "handlers" / "account.php").read_text(encoding="utf-8")
    assert "if ($action === 'overview' || $action === 'me')" in account
    assert "?>" not in account
    assert account.rstrip().endswith("}")
