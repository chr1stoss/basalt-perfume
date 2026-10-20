"""Bot-only regression checks for uploaded groups, duplicates, and result delivery."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_upload_group_is_registered_before_waiting_for_user_message_cleanup():
    upload = (ROOT / "bot/handlers/routers/price_lists/upload.py").read_text(encoding="utf-8")
    block = upload.split("@router.message(F.document)", 1)[1]
    assert block.index("_batch_queues.setdefault") < block.rindex("await delete_user_message(message)")
    queue = (ROOT / "bot/handlers/common/files/queue.py").read_text(encoding="utf-8")
    assert queue.count('await bot.get_file(item["file_id"])') == 1
    context = (ROOT / "bot/handlers/common/runtime/context.py").read_text(encoding="utf-8")
    assert "MEDIA_GROUP_COALESCE_SECONDS" in context


def test_batch_reports_received_files_in_one_localized_notification():
    source = (ROOT / "bot/handlers/common/files/batch.py").read_text(encoding="utf-8")
    assert 'tr(language, "batch_received_body", count=len(items)' in source
    assert "asyncio.gather(" in source
    assert 'process_price_file(bot, tg_id, item["filename"]' in source


def test_duplicate_prompt_has_one_confirmation_row_and_explicit_cancel_action():
    batch = (ROOT / "bot/handlers/common/files/batch.py").read_text(encoding="utf-8")
    keyboard = (ROOT / "bot/handlers/common/keyboards/replacement.py").read_text(encoding="utf-8")
    assert "replacement_keyboard(token, language, conflict_items" in batch
    assert "replace_open:{token}:{index}" in keyboard
    assert "Подтвердить выбранные действия" in keyboard
    assert "Отменить группу" in keyboard
    assert keyboard.index("rows.append([InlineKeyboardButton(text=confirm_text") > keyboard.index("for item in items")


def test_duplicate_review_shows_saved_and_incoming_files_and_confirmed_actions():
    review = (ROOT / "bot/handlers/routers/price_lists/duplicate_review.py").read_text(encoding="utf-8")
    confirm = (ROOT / "bot/handlers/routers/price_lists/duplicate_edit.py").read_text(encoding="utf-8")
    cancel = (ROOT / "bot/handlers/routers/price_lists/duplicate_cancel.py").read_text(encoding="utf-8")
    for text in ("Было (сохранённая версия)", "Станет (загружаемый файл)", "Товаров:", "Строк:", "Вес файла:"):
        assert text in review
    assert "if not selected_replace:" in confirm
    assert "Старые файлы оставлены без изменений; новые дубликаты пропущены." in confirm
    assert "Выбор подтверждён. Старые файлы будут заменены." in confirm
    assert "Сначала выберите действие для каждого файла" in confirm
    assert "Данные не будут изменены" in cancel
    assert "await call.message.delete()" in cancel


def test_bulk_download_tracks_all_album_messages_for_deletion_control():
    bulk = (ROOT / "bot/handlers/common/files/bulk_download.py").read_text(encoding="utf-8")
    actions = (ROOT / "bot/handlers/routers/downloads/actions.py").read_text(encoding="utf-8")
    assert "await bot.send_media_group(chat_id=chat_id, media=media)" in bulk
    assert '"album_message_ids": sent_album_ids' in bulk
    assert 'F.data.startswith("delete_download_group:")' in actions
    assert 'for message_id in [*group.get("album_message_ids", []), group.get("control_message_id")]' in actions


def test_duplicate_content_hash_and_name_normalization_are_available():
    service = (ROOT / "bot/services/file_names.py").read_text(encoding="utf-8")
    assert "def normalize_filename" in service
    assert "def file_content_sha256" in service
    assert "def filename_similarity" in service
    assert "def workbook_semantic_sha256" in service
