from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "htdocs"


def test_favorite_share_has_captured_action_and_visible_manual_fallback():
    app = (WEB / "assets/app.js").read_text(encoding="utf-8")
    assert "currentShareGroups=Object.create(null)" in app
    assert "event.stopImmediatePropagation()" in app
    assert "function showShareComposer(group,text)" in app
    assert "copyFavoritesShareText" in app and "openFavoritesShareTelegram" in app
    assert "group.shareKey" in app


def test_filter_options_use_catalog_for_buyers_and_admins_and_keep_seller_scoped():
    api = (WEB / "api.php").read_text(encoding="utf-8")
    app = (WEB / "assets/app.js").read_text(encoding="utf-8")
    assert "$globalCatalog = $isBuyer || $isAdmin || $isPublicCatalogFallback" in api
    assert "FROM products p" in api
    assert "$isPublicCatalogFallback = $isSellerWithoutLists" in api
    assert "SELECT DISTINCT p.brand" in api and "SELECT DISTINCT p.volume_ml" in api
    assert "$stmt->execute($scopeArgs); $brands=$stmt->fetchAll(PDO::FETCH_COLUMN)" in api
    assert "data-seller-select" in app
    assert "closest('[data-filter-select-key], [data-seller-select]')" in app


def test_update_notification_icon_has_a_real_svg_path():
    icons = (WEB / "assets/js/components/icons.js").read_text(encoding="utf-8")
    app = (WEB / "assets/app.js").read_text(encoding="utf-8")
    assert "megaphone:" in icons
    assert "iconSvg('megaphone')" in app


def test_webp_placeholders_and_renamed_logo_are_used():
    app = (WEB / "assets/app.js").read_text(encoding="utf-8")
    header = (WEB / "components/header.php").read_text(encoding="utf-8")
    for name in ("avatar-placeholder.webp", "logo-placeholder.webp", "logo.jpg", "logo.webp", "logo.svg"):
        assert (WEB / "assets" / "img" / name).is_file()
    assert "assets/img/avatar-placeholder.webp?v=6" in app
    assert "assets/img/logo.svg?v=1" in header
    assert "assets/img/logo.webp?v=5" not in header
    assert "assets/img/logo-placeholder.webp?v=5" not in header
    for source in [WEB / "api.php", WEB / "components/header.php", WEB / "assets/app.js"]:
        assert "black.png" not in source.read_text(encoding="utf-8")


def test_announcement_delivery_is_queued_and_worker_is_started():
    api = (WEB / "api.php").read_text(encoding="utf-8")
    service = (ROOT / "bot/services/queues/announcement_queue.py").read_text(encoding="utf-8")
    main = (ROOT / "main.py").read_text(encoding="utf-8")
    assert "telegram_notification_queue" in api and "telegram_queued" in api
    assert "async def process_announcement_queue(bot: Bot)" in service
    assert "announcement_queue_task=asyncio.create_task" in main
    assert (ROOT / "bot/database/migrations/11_telegram_notification_queue.sql").is_file()


def test_maintenance_remains_enforced_on_bot_events_and_webapp_api_actions():
    router = "\n".join(p.read_text(encoding="utf-8") for p in (ROOT / "bot/handlers").rglob("*.py"))
    api = (WEB / "api.php").read_text(encoding="utf-8")
    app = (WEB / "assets/app.js").read_text(encoding="utf-8")
    assert "router.message.middleware(MaintenanceMiddleware())" in router
    assert "router.callback_query.middleware(MaintenanceMiddleware())" in router
    assert "maintenance_state($pdo)" in api and "'maintenance_mode'" in api
    assert "renderSystemLock('maintenance'" in app
