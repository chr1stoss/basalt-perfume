from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_how_upload_inline_button_is_always_part_of_main_keyboard():
    source = (ROOT / "bot/handlers/common/keyboards/main.py").read_text(encoding="utf-8")
    assert 'InlineKeyboardButton(text=tr(language, "how_upload"), callback_data="how_upload")' in source
    assert 'if role in ("seller", "admin")' not in source


def test_how_upload_callback_is_public_and_only_opens_instructions():
    source = (ROOT / "bot/handlers/routers/catalogue/navigation.py").read_text(encoding="utf-8")
    callback = source.split('@router.callback_query(F.data == "how_upload")', 1)[1].split('@router.callback_query(F.data == "home")', 1)[0]
    assert "get_user_role" not in callback
    assert "buyer_upload_disabled" not in callback
    assert "none_subscription_required" not in callback
    assert "await show_call_view(call, UPLOAD_IMAGE" in callback
    assert 'tr(language, "how_upload_title")' in callback
    assert 'tr(language, "how_upload_body")' in callback
