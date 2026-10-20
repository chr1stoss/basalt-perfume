from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def test_deleted_user_message_has_contact_and_read_buttons_on_same_row():
    worker = (ROOT / "bot/services/queues/user_deletion_queue.py").read_text(encoding="utf-8")
    handler = (ROOT / "bot/handlers/routers/catalogue/notifications.py").read_text(encoding="utf-8")
    assert "settings.admin_ids[0]" in worker
    assert "SELECT username FROM users WHERE tg_id=%s LIMIT 1" in worker
    assert 'InlineKeyboardButton(text="Написать", url=contact_url)' in worker
    assert 'InlineKeyboardButton(text="Прочитано", callback_data="dismiss_notice")' in worker
    assert "InlineKeyboardMarkup(inline_keyboard=[buttons])" in worker
    assert 'reply_markup=_deleted_user_notice_keyboard(contact_url)' in worker
    assert '@router.callback_query(F.data == "dismiss_notice")' in handler
    assert 'await bot.delete_message(chat_id=call.message.chat.id, message_id=call.message.message_id)' in handler
