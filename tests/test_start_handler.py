from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _start_source():
    source = (ROOT / "bot/handlers/routers/start/entry.py").read_text(encoding="utf-8")
    return source.split('@router.message(CommandStart())', 1)[1]


def test_normal_start_renders_final_menu_once_and_replaces_stale_menu_without_editing_it():
    start = _start_source()
    assert 'if not payload or payload.lower() in ("webapp", "open", "menu")' in start
    assert 'body = await menu_body(message.from_user.id, language)' in start
    assert 'await show_view(' in start
    assert 'body, main_keyboard(language, role), reuse_main=False' in start
    assert 'schedule_fast_start_enrichment(' not in start
    assert 'response_sent = True' in start
    assert start.index('response_sent = True') < start.index('schedule_delete_user_message(message)')


def test_start_preserves_language_deep_links_and_has_database_failure_fallback():
    start = _start_source()
    assert "switch_lang_(ru|en|kz)" in start
    assert "await set_user_language(message.from_user.id" in start
    assert 'Could not build personalized /start menu tg_id=%s' in start
    assert 'Failed to process /start for tg_id=%s' in start
    assert 'Could not send fallback /start response to tg_id=%s' in start
    assert 'main_keyboard(language, await get_user_role(message.from_user.id))' in start
