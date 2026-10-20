from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_duplicate_prompt_is_one_message_with_dynamic_rows_and_static_actions():
    batch = (ROOT / "bot/handlers/common/files/batch.py").read_text(encoding="utf-8")
    keyboard = (ROOT / "bot/handlers/common/keyboards/replacement.py").read_text(encoding="utf-8")
    assert "await bot.send_message(" in batch
    assert "replacement_keyboard(token, language, conflict_items" in batch
    assert "replace_open:{token}:{index}" in keyboard
    assert "Подтвердить выбранные действия" in keyboard
    assert "Отменить группу" in keyboard
    assert keyboard.index("rows.append([InlineKeyboardButton(text=confirm_text") > keyboard.index("for item in items")


def test_duplicate_details_show_old_and_incoming_product_rows_and_file_size():
    review = (ROOT / "bot/handlers/routers/price_lists/duplicate_review.py").read_text(encoding="utf-8")
    assert "Было (сохранённая версия)" in review
    assert "Станет (загружаемый файл)" in review
    assert "Товаров:" in review
    assert "Строк:" in review
    assert "Вес файла:" in review


def test_cancel_and_confirm_alert_then_delete_prompt_message():
    cancel = (ROOT / "bot/handlers/routers/price_lists/duplicate_cancel.py").read_text(encoding="utf-8")
    apply = (ROOT / "bot/handlers/routers/price_lists/duplicate_edit.py").read_text(encoding="utf-8")
    assert "Данные не будут изменены" in cancel
    assert "await call.message.delete()" in cancel
    assert "Старые файлы будут заменены" in apply
    assert "await call.message.delete()" in apply
    assert "Сначала выберите действие для каждого файла" in apply


def test_conflict_rows_are_resolved_defensively_and_empty_rows_cannot_process():
    batch = (ROOT / "bot/handlers/common/files/batch.py").read_text(encoding="utf-8")
    apply = (ROOT / "bot/handlers/routers/price_lists/duplicate_edit.py").read_text(encoding="utf-8")
    keyboard = (ROOT / "bot/handlers/common/keyboards/replacement.py").read_text(encoding="utf-8")
    assert "def _resolve_conflict_key" in batch
    assert "def _build_conflict_items" in batch
    assert '"conflict_norm": conflict_key' in batch
    assert "if not items:" in apply
    assert "expected_conflicts - displayed_conflicts" in apply
    assert "No data was changed" in apply
    assert "if items:" in keyboard
    assert "any(int(item[\"index\"]) not in choices for item in items)" not in apply


def test_final_alert_matches_selected_actions_and_all_keep_sends_no_extra_message():
    apply = (ROOT / "bot/handlers/routers/price_lists/duplicate_edit.py").read_text(encoding="utf-8")
    assert "if not selected_replace:" in apply
    assert "Старые файлы оставлены без изменений; новые дубликаты пропущены." in apply
    assert "Выбор подтверждён. Старые файлы будут заменены." in apply
    assert "Будут заменены только файлы, для которых выбрано «Заменить»" in apply
    assert "if filtered_files:" in apply
    assert 'await bot.send_message(call.from_user.id, {"ru": "Старые файлы оставлены без изменений' not in apply
