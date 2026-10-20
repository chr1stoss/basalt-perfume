from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def test_avatar_photo_hides_placeholder_and_error_restores_fallback():
    app = (ROOT / "htdocs/assets/app.js").read_text(encoding="utf-8")
    css = (ROOT / "htdocs/assets/css/visual-system.css").read_text(encoding="utf-8")
    markup = app[app.index("function avatarMarkup"):app.index("function localeTag")]
    assert "has-photo" in markup and "avatar-image" in markup
    assert "classList.remove('has-photo')" in app
    assert ".avatar-shell.has-photo .avatar-placeholder { display: none !important" in css
    assert 'assets/img/avatar-placeholder.webp?v=6' in app


def test_frontend_translation_catalogues_have_same_keys():
    app = (ROOT / "htdocs/assets/app.js").read_text(encoding="utf-8")
    start_en = app.index("    var en = {")
    start_kz = app.index("    var kz = {", start_en)
    end_kz = app.index("    var map = lang ===", start_kz)
    en = set(re.findall(r"['\"]([^'\"]+)['\"]\s*:", app[start_en:start_kz]))
    kz = set(re.findall(r"['\"]([^'\"]+)['\"]\s*:", app[start_kz:end_kz]))
    assert en == kz
    assert "Скачать все" in en
    assert "Применить язык в Telegram" in en


def test_telegram_catalogue_translation_catalogues_have_same_keys():
    from bot.core.i18n import MESSAGES
    assert set(MESSAGES["ru"]) == set(MESSAGES["en"]) == set(MESSAGES["kz"])
    assert "batch_received_body" in MESSAGES["en"]
    assert "replace_body" in MESSAGES["kz"]


def test_upload_group_is_enqueued_before_slow_delete_and_only_downloaded_once():
    router = (ROOT / "bot/handlers/routers/price_lists/upload.py").read_text(encoding="utf-8")
    upload = router.split('@router.message(F.document)', 1)[1]
    assert upload.index("_batch_queues.setdefault") < upload.rindex("await delete_user_message(message)")
    download = (ROOT / "bot/handlers/common/files/queue.py").read_text(encoding="utf-8")
    assert download.count('await bot.get_file(item["file_id"])') == 1
    assert "MEDIA_GROUP_COALESCE_SECONDS" in (ROOT / "bot/handlers/common/runtime/context.py").read_text(encoding="utf-8")
    assert 'tr(language, "batch_received_body", count=len(items)' in (ROOT / "bot/handlers/common/files/batch.py").read_text(encoding="utf-8")


def test_bulk_download_group_tracks_album_messages_for_delete_control():
    bulk = (ROOT / "bot/handlers/common/files/bulk_download.py").read_text(encoding="utf-8")
    actions = (ROOT / "bot/handlers/routers/downloads/actions.py").read_text(encoding="utf-8")
    assert "await bot.send_media_group(chat_id=chat_id, media=media)" in bulk
    assert '"album_message_ids": sent_album_ids' in bulk
    assert 'F.data.startswith("delete_download_group:")' in actions
    assert "for message_id in [*group.get(\"album_message_ids\", []), group.get(\"control_message_id\")]" in actions


def test_transient_notice_cleanup_has_hard_two_attempt_cap_and_logs_failures():
    router = (ROOT / "bot/handlers/common/notifications/ephemeral.py").read_text(encoding="utf-8")
    block = router.split("async def _delete_message_after", 1)[1]
    assert "for attempt in range(1, 3)" in block
    assert "retrying once" in block
    notifications = (ROOT / "bot/services/notifications/telegram.py").read_text(encoding="utf-8")
    assert "MAX_DELETE_ATTEMPTS = 2" in notifications
    assert "Abandoning Telegram cleanup row" in notifications


def test_filename_duplicate_detection_and_replacement_preserve_new_candidates():
    router = "\n".join(p.read_text(encoding="utf-8") for p in (ROOT / "bot/handlers/common/files").rglob("*.py")) + "\n".join(p.read_text(encoding="utf-8") for p in (ROOT / "bot/handlers/routers/price_lists").rglob("*.py"))
    assert "normalize_filename(path.name)" in router
    assert "PENDING_BATCHES[token]" in router and "replacement_keyboard(token, language)" in router
    assert "candidate_paths" in router and "Refusing to remove old price list" in router
    assert 'path.unlink()' in router


def test_language_deep_link_and_persistent_menu_migration_are_additive():
    router = (ROOT / "bot/handlers/routers/start/entry.py").read_text(encoding="utf-8")
    migration = (ROOT / "bot/database/migrations/07_persistent_bot_menu.sql").read_text(encoding="utf-8").upper()
    assert "switch_lang_(ru|en|kz|kk)" in router
    assert "await set_user_language(message.from_user.id" in router
    assert "MENU_CHAT_ID" in migration and "MENU_MESSAGE_ID" in migration
    assert "DROP TABLE" not in migration and "DROP COLUMN" not in migration


def test_static_cache_versions_are_updated_for_placeholder_and_i18n_fixes():
    index = (ROOT / "htdocs/index.php").read_text(encoding="utf-8")
    assert __import__('re').search(r'src="assets/app.js\?v=\d+"', index)
    assert __import__('re').search(r'href="assets/app.css\?v=\d+"', index)
    assert __import__('re').search(r'visual-system.css\?v=\d+"', index)
    header = (ROOT/'htdocs/components/header.php').read_text(encoding='utf-8')
    assert 'assets/img/logo.svg?v=1' in header
