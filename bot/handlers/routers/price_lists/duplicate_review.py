from aiogram import Router
from bot.handlers.common import *
from bot.handlers.common.keyboards.replacement import replacement_keyboard
from bot.handlers.common.keyboards.replace_item import replacement_item_keyboard

router = Router(name="basalt-duplicate-review")


def _size_label(size):
    try:
        value = int(size or 0)
    except (TypeError, ValueError):
        value = 0
    if value >= 1024 * 1024:
        return f"{value / (1024 * 1024):.2f} МБ"
    if value >= 1024:
        return f"{value / 1024:.1f} КБ"
    return f"{value} Б"


async def _get_existing_stats(pending, info):
    """Read the old price-list size and row/product counts without mutating data."""
    from bot.database.connection import pool
    conflict_key = info.get("conflict_norm", info["norm"])
    ids = sorted(int(x) for x in pending.get("conflicts", {}).get(conflict_key, {}).get("ids", set()))
    result = []
    if not ids:
        return result
    async with pool().acquire() as conn:
        async with conn.cursor() as cur:
            for price_list_id in ids:
                await cur.execute(
                    "SELECT id, filename, size_bytes FROM price_lists WHERE id=%s AND owner_tg_id=%s LIMIT 1",
                    (price_list_id, int(pending["tg_id"])),
                )
                row = await cur.fetchone()
                if not row:
                    continue
                await cur.execute("SELECT COUNT(*) FROM source_rows WHERE price_list_id=%s", (price_list_id,))
                row_count = int((await cur.fetchone())[0] or 0)
                await cur.execute(
                    "SELECT COUNT(*) FROM products p JOIN source_rows sr ON sr.id=p.source_row_id WHERE sr.price_list_id=%s",
                    (price_list_id,),
                )
                product_count = int((await cur.fetchone())[0] or 0)
                result.append({"filename": str(row[1]), "size": int(row[2] or 0), "rows": row_count, "products": product_count})
    return result


async def _get_incoming_stats(info):
    cached = info.get("preview_stats")
    if cached:
        return cached
    path = Path(info.get("path") or "")
    size = int(info.get("size") or (path.stat().st_size if path.is_file() else 0))
    stats = {"size": size, "rows": None, "products": None}
    if path.is_file() and path.suffix.casefold() in {".xls", ".xlsx", ".xlsm", ".csv", ".tsv", ".txt"}:
        try:
            from bot.services.parser.price_list import _load_engine_and_parse
            parsed = await asyncio.to_thread(_load_engine_and_parse, path, str(info.get("filename") or path.name))
            stats["rows"] = len(parsed.get("source_rows") or [])
            stats["products"] = len(parsed.get("products") or [])
        except Exception:
            log.exception("Could not calculate duplicate preview stats filename=%r", info.get("filename"))
    info["preview_stats"] = stats
    return stats


def _detail_text(language, info, old_stats, new_stats):
    if language == "en":
        lines = [f"File: {info['filename']}", "", "Existing version:"]
        if old_stats:
            lines.extend(f"• {x['filename']} — products: {x['products']}, rows: {x['rows']}, size: {_size_label(x['size'])}" for x in old_stats)
        else:
            lines.append("• Existing record details are unavailable.")
        lines.extend(["", "Incoming version:", f"• Products: {new_stats['products'] if new_stats['products'] is not None else '—'}", f"• Rows: {new_stats['rows'] if new_stats['rows'] is not None else '—'}", f"• File size: {_size_label(new_stats['size'])}", "", "Choose what to do with this file:"])
        return "\n".join(lines)
    if language == "kz":
        lines = [f"Файл: {info['filename']}", "", "Бұрынғы нұсқа:"]
        if old_stats:
            lines.extend(f"• {x['filename']} — тауарлар: {x['products']}, жолдар: {x['rows']}, көлемі: {_size_label(x['size'])}" for x in old_stats)
        else:
            lines.append("• Бұрынғы жазба туралы мәлімет жоқ.")
        lines.extend(["", "Жаңа нұсқа:", f"• Тауарлар: {new_stats['products'] if new_stats['products'] is not None else '—'}", f"• Жолдар: {new_stats['rows'] if new_stats['rows'] is not None else '—'}", f"• Файл көлемі: {_size_label(new_stats['size'])}", "", "Осы файл үшін әрекетті таңдаңыз:"])
        return "\n".join(lines)
    lines = [f"Файл: {info['filename']}", "", "Было (сохранённая версия):"]
    if old_stats:
        lines.extend(f"• {x['filename']} — товаров: {x['products']}, строк: {x['rows']}, вес: {_size_label(x['size'])}" for x in old_stats)
    else:
        lines.append("• Данные старой записи недоступны.")
    lines.extend(["", "Станет (загружаемый файл):", f"• Товаров: {new_stats['products'] if new_stats['products'] is not None else '—'}", f"• Строк: {new_stats['rows'] if new_stats['rows'] is not None else '—'}", f"• Вес файла: {_size_label(new_stats['size'])}", "", "Выберите действие для этого файла:"])
    return "\n".join(lines)


async def _return_to_list(call, token, pending, language):
    prompt_text = {
        "ru": "В группе есть файлы с похожими именами. Для каждого выберите действие, затем подтвердите общий результат.",
        "en": "Some files in this batch have similar names. Choose an action for each, then confirm the overall result.",
        "kz": "Топта атаулары ұқсас файлдар бар. Әрқайсысы үшін әрекетті таңдап, жалпы нәтижені растаңыз.",
    }.get(language, "В группе есть файлы с похожими именами. Для каждого выберите действие, затем подтвердите общий результат.")
    if call.message:
        await call.message.edit_text(prompt_text, reply_markup=replacement_keyboard(token, language, pending.get("conflict_items", []), pending.get("choices", {})))


@router.callback_query(F.data.startswith("replace_open:"))
async def open_duplicate_file_details(call: CallbackQuery):
    language = await get_language_or_default(call.from_user.id)
    try:
        _prefix, token, raw_index = call.data.split(":", 2)
        index = int(raw_index)
    except (ValueError, AttributeError):
        await call.answer(tr(language, "expired_confirmation"), show_alert=True)
        return
    pending = PENDING_BATCHES.get(token)
    if not pending or int(pending.get("tg_id", 0)) != int(call.from_user.id):
        await call.answer(tr(language, "expired_confirmation"), show_alert=True)
        return
    info = next((x for x in pending.get("conflict_items", []) if int(x["index"]) == index), None)
    if not info:
        await call.answer(tr(language, "expired_confirmation"), show_alert=True)
        return
    await call.answer()
    try:
        old_stats = await _get_existing_stats(pending, info)
        new_stats = await _get_incoming_stats(info)
        text = _detail_text(language, info, old_stats, new_stats)
        if call.message:
            await call.message.edit_text(text, reply_markup=replacement_item_keyboard(token, index, language, pending.get("choices", {}).get(index)))
    except Exception:
        log.exception("Could not show duplicate details token=%s index=%s", token, index)
        if call.message:
            try:
                await call.message.edit_text("Не удалось получить подробности файла. Выберите действие или вернитесь к списку.", reply_markup=replacement_item_keyboard(token, index, language, pending.get("choices", {}).get(index)))
            except Exception:
                log.debug("Could not render fallback duplicate detail", exc_info=True)


@router.callback_query(F.data.startswith("replace_item:"))
async def choose_duplicate_file_action(call: CallbackQuery):
    language = await get_language_or_default(call.from_user.id)
    try:
        _prefix, token, raw_index, choice = call.data.split(":", 3)
        index = int(raw_index)
    except (ValueError, AttributeError):
        await call.answer(tr(language, "expired_confirmation"), show_alert=True)
        return
    pending = PENDING_BATCHES.get(token)
    if not pending or int(pending.get("tg_id", 0)) != int(call.from_user.id) or choice not in {"replace", "keep"}:
        await call.answer(tr(language, "expired_confirmation"), show_alert=True)
        return
    valid_indexes = {int(item["index"]) for item in pending.get("conflict_items", [])}
    if index not in valid_indexes:
        await call.answer(tr(language, "expired_confirmation"), show_alert=True)
        return
    pending.setdefault("choices", {})[index] = choice
    await call.answer({"ru": "Выбор сохранён", "en": "Choice saved", "kz": "Таңдау сақталды"}.get(language, "Выбор сохранён"))
    try:
        await _return_to_list(call, token, pending, language)
    except Exception:
        log.exception("Could not return to duplicate list token=%s", token)


@router.callback_query(F.data.startswith("replace_confirm_choices:"))
async def review_duplicate_file_choices(call: CallbackQuery, bot: Bot):
    # The bottom confirmation button now applies the choices directly; no extra summary message.
    from bot.handlers.routers.price_lists.duplicate_edit import apply_duplicate_file_choices
    await apply_duplicate_file_choices(call, bot)
