"""Language catalog contract tests for the Telegram bot."""
from pathlib import Path

from bot.core.i18n import MESSAGES

ROOT = Path(__file__).resolve().parents[1]


def test_russian_english_and_kazakh_catalogues_have_identical_keys():
    assert set(MESSAGES) == {"ru", "en", "kz"}
    assert set(MESSAGES["ru"]) == set(MESSAGES["en"]) == set(MESSAGES["kz"])
    assert "kk" not in MESSAGES


def test_currently_used_start_upload_and_subscription_messages_are_translated():
    required = {
        "main_title", "how_upload", "how_upload_title", "how_upload_body",
        "activation_title", "activation_prompt", "key_success_title",
        "key_bad_title", "start_failed_body", "unexpected_error_title",
        "unexpected_error_body", "read",
    }
    for language in ("ru", "en", "kz"):
        assert required <= set(MESSAGES[language])
        for key in required:
            assert isinstance(MESSAGES[language][key], str) and MESSAGES[language][key].strip(), (language, key)


def test_language_handler_uses_kz_as_the_kazakh_deep_link_code():
    source = (ROOT / "bot/handlers/routers/start/entry.py").read_text(encoding="utf-8")
    assert "switch_lang_(ru|en|kz)" in source
    assert "switch_lang_(ru|en|kz|kk)" not in source
