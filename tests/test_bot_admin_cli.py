"""Tests for the browser-independent administrative CLI and its safety checks."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_cli_exposes_confirmed_user_deletion_and_key_change_commands():
    source = (ROOT / "admin-cli.py").read_text(encoding="utf-8")
    assert 'sub.add_parser("change-user-key"' in source
    assert 'sub.add_parser("delete-user"' in source
    assert 'await cur.execute("UPDATE users SET role=%s WHERE tg_id=%s", (role_value, args.user_id))' in source
    assert 'args.confirm != str(args.user_id)' in source


def test_cli_handles_keyboard_interrupt_without_traceback():
    source = (ROOT / "admin-cli.py").read_text(encoding="utf-8")
    assert "except KeyboardInterrupt:" in source


def test_deleted_user_notice_contains_contact_and_read_buttons_and_dismiss_handler():
    worker = (ROOT / "bot/services/queues/user_deletion_queue.py").read_text(encoding="utf-8")
    handler = (ROOT / "bot/handlers/routers/catalogue/notifications.py").read_text(encoding="utf-8")
    assert "settings.admin_ids[0]" in worker
    assert 'InlineKeyboardButton(text="Написать", url=contact_url)' in worker
    assert 'InlineKeyboardButton(text="Прочитано", callback_data="dismiss_notice")' in worker
    assert 'reply_markup=_deleted_user_notice_keyboard(contact_url)' in worker
    assert '@router.callback_query(F.data == "dismiss_notice")' in handler
    assert 'await bot.delete_message(chat_id=call.message.chat.id, message_id=call.message.message_id)' in handler
