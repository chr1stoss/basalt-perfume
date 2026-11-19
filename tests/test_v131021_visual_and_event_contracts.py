from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public_html"


def test_telegram_webapp_user_avatar_never_uses_external_photo_url_directly():
    app = (PUBLIC / "assets" / "app.js").read_text(encoding="utf-8")
    start = app.index("function photoUrl(p)")
    end = app.index("function avatarMarkup", start)
    body = app[start:end]
    assert "isCurrentTelegramUser" in body
    assert "avatar_url_is_local_for_client(p.photo_url)" in body
    assert "(!initData && tg && tg.initDataUnsafe" in body


def test_webapp_avatar_refresh_is_non_blocking_and_cached_server_side():
    app = (PUBLIC / "assets" / "app.js").read_text(encoding="utf-8")
    assert "api('cache_avatar',{refresh:1}).then" in app
    assert "updateCurrentUserAvatar(result.photo_url)" in app
    account = (PUBLIC / "api" / "handlers" / "account.php").read_text(encoding="utf-8")
    assert "cache_telegram_avatar_from_url" in account
    assert "cache_telegram_avatar_from_bot_api" in account
    router = (PUBLIC / "api" / "router.php").read_text(encoding="utf-8")
    assert "'cache_avatar'" in router


def test_admin_stats_endpoint_is_wired_and_admin_handler_has_no_early_php_close():
    app = (PUBLIC / "assets" / "app.js").read_text(encoding="utf-8")
    admin = (PUBLIC / "api" / "handlers" / "admin.php").read_text(encoding="utf-8")
    router = (PUBLIC / "api" / "router.php").read_text(encoding="utf-8")
    assert "api('admin_stats')" in app
    assert "if ($action === 'admin_stats')" in admin
    assert "handlers/admin.php" in router
    assert admin.count("?>") <= 1
    if "?>" in admin:
        assert admin.rstrip().endswith("?>")


def test_api_background_status_polls_do_not_refresh_session_or_lock_guards():
    router = (PUBLIC / "api" / "router.php").read_text(encoding="utf-8")
    app = (PUBLIC / "assets" / "app.js").read_text(encoding="utf-8")
    assert "in_array($action, array('files','upload_review_status'), true)" in router
    assert "if (!$backgroundStatusPoll) enforce_account_locks" in router
    assert "if (!$backgroundStatusPoll && $action !== 'session_sync'" in router
    start = app.index("function startBpSessionSync()")
    end = app.index("function installPopupSessionChecks()", start)
    assert "setInterval" not in app[start:end]


def test_mobile_asset_cache_versions_and_fallback_images_are_present():
    for page in (PUBLIC / "mobile").glob("*.html"):
        text = page.read_text(encoding="utf-8")
        if "app.js" in text:
            assert "/assets/app.js?v=108" in text
    assert (PUBLIC / "assets" / "img" / "avatar-placeholder.webp").is_file()
    assert (PUBLIC / "assets" / "img" / "logo.webp").is_file()
    assert (PUBLIC / "assets" / "img" / "logo.svg").is_file()


def test_upload_completion_refreshes_unread_even_when_first_seen_terminal():
    app = (PUBLIC / "assets" / "app.js").read_text(encoding="utf-8")
    assert "priceFileStatusExpectedIds[String(item.file_id)]=true" in app
    assert "priceFileStatusExpectedIds[id]&&/^(ready|error|failed)$/.test(status)" in app
    assert "delete priceFileStatusExpectedIds[id]" in app
