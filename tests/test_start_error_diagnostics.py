from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_start_fallback_does_not_report_a_file_batch_failure():
    source = (ROOT / "bot/handlers/routers/start/entry.py").read_text(encoding="utf-8")
    assert 'tr(language, "start_failed_body")' in source
    assert 'tr(language, "batch_failed_body")' not in source
    assert 'log.exception("Failed to process /start for tg_id=%s"' in source


def test_unhandled_message_errors_use_generic_not_file_batch_notice():
    source = (ROOT / "bot/handlers/routers/system/errors.py").read_text(encoding="utf-8")
    assert 'tr(language, "unexpected_error_title")' in source
    assert 'tr(language, "unexpected_error_body")' in source
    assert 'tr(language, "batch_failed_title")' not in source


def test_invalid_webapp_url_cannot_block_main_keyboard_construction():
    source = (ROOT / "bot/handlers/common/keyboards/main.py").read_text(encoding="utf-8")
    assert 'parsed.scheme.lower() == "https" and bool(parsed.hostname)' in source
    assert 'if _valid_webapp_url(webapp_url):' in source
    assert 'WEBAPP_URL is missing or invalid' in source
    assert 'callback_data="activate"' in source
    assert 'callback_data="how_upload"' in source


def test_generic_error_messages_exist_for_all_supported_languages():
    source = (ROOT / "bot/core/i18n.py").read_text(encoding="utf-8")
    for key in ("start_failed_body", "unexpected_error_title", "unexpected_error_body"):
        assert source.count(f'"{key}":') == 3


def test_activation_database_failure_does_not_claim_file_batch_failed():
    source = (ROOT / "bot/handlers/routers/subscription/activation.py").read_text(encoding="utf-8")
    assert 'tr(language, "unexpected_error_title")' in source
    assert 'tr(language, "batch_failed_body")' not in source
