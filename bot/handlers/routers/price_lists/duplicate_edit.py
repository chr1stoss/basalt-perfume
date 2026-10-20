from aiogram import Router
from bot.handlers.common import *
from bot.handlers.common.keyboards.replacement import replacement_keyboard

router = Router(name="basalt-duplicate-edit")

@router.callback_query(F.data.startswith("replace_edit_choices:"))
async def edit_duplicate_file_choices(call: CallbackQuery):
    language = await get_language_or_default(call.from_user.id)
    token = call.data.split(":", 1)[1]
    pending = PENDING_BATCHES.get(token)
    if not pending or int(pending.get("tg_id", 0)) != int(call.from_user.id):
        await call.answer(tr(language, "expired_confirmation"), show_alert=True)
        return
    await call.answer()
    if call.message:
        text = {"ru": "В группе есть файлы с похожими именами. Для каждого выберите действие, затем подтвердите общий результат.", "en": "Some files in this batch have similar names. Choose an action for each, then confirm the overall result.", "kz": "Топта атаулары ұқсас файлдар бар. Әрқайсысы үшін әрекетті таңдап, жалпы нәтижені растаңыз."}.get(language, "В группе есть файлы с похожими именами. Для каждого выберите действие, затем подтвердите общий результат.")
        try: await call.message.edit_text(text, reply_markup=replacement_keyboard(token, language, pending.get("conflict_items", []), pending.get("choices", {})))
        except Exception: log.debug("Could not return to duplicate choices", exc_info=True)

@router.callback_query(F.data.startswith("replace_apply_choices:"))
async def apply_duplicate_file_choices_compat(call: CallbackQuery, bot: Bot):
    await apply_duplicate_file_choices(call, bot)

async def apply_duplicate_file_choices(call: CallbackQuery, bot: Bot):
    language = await get_language_or_default(call.from_user.id)
    token = call.data.split(":", 1)[1]
    pending = PENDING_BATCHES.get(token)
    if not pending or int(pending.get("tg_id", 0)) != int(call.from_user.id):
        await call.answer(tr(language, "expired_confirmation"), show_alert=True)
        return
    items = pending.get("conflict_items", [])
    choices = pending.get("choices", {})
    # Empty conflict_items used to pass the all-selected check vacuously (any([])
    # is False) and let every staged file continue into processing. Fail closed.
    if not items:
        await call.answer({"ru": "Не удалось определить список конфликтных файлов. Данные не изменены; отмените группу и отправьте файлы повторно.", "en": "The conflicting file list is missing. No data was changed; cancel this batch and upload the files again.", "kz": "Қайшылықты файлдар тізімі жоқ. Деректер өзгертілмеді; топтан бас тартып, файлдарды қайта жіберіңіз."}.get(language, "Не удалось определить список конфликтных файлов. Данные не изменены; отмените группу и отправьте файлы повторно."), show_alert=True)
        return
    expected_conflicts = set(pending.get("conflicts", {}))
    displayed_conflicts = {item.get("conflict_norm", item.get("norm")) for item in items}
    if expected_conflicts - displayed_conflicts:
        await call.answer({"ru": "Не все конфликтные файлы попали в список. Данные не изменены; отмените группу и отправьте файлы повторно.", "en": "Not all conflicting files are listed. No data was changed; cancel this batch and upload the files again.", "kz": "Қайшылықты файлдардың барлығы тізімге кірмеді. Деректер өзгертілмеді; топтан бас тартып, файлдарды қайта жіберіңіз."}.get(language, "Не все конфликтные файлы попали в список. Данные не изменены; отмените группу и отправьте файлы повторно."), show_alert=True)
        return
    missing = []
    for item in items:
        idx = int(item["index"])
        choice = choices.get(idx, choices.get(str(idx)))
        if choice not in {"replace", "keep"}:
            missing.append(idx)
    if missing:
        await call.answer({"ru": "Сначала выберите действие для каждого файла", "en": "Choose an action for every file first", "kz": "Алдымен әр файл үшін әрекетті таңдаңыз"}.get(language, "Сначала выберите действие для каждого файла"), show_alert=True)
        return
    selected_replace = [item for item in items if choices.get(int(item["index"]), choices.get(str(int(item["index"])))) == "replace"]
    if not selected_replace:
        # Every conflict was marked keep: the alert itself is the only user-facing
        # confirmation. Do not send a second explanatory chat message afterwards.
        confirmation_text = {
            "ru": "Старые файлы оставлены без изменений; новые дубликаты пропущены.",
            "en": "Existing files were kept; duplicate uploads were skipped.",
            "kz": "Ескі файлдар өзгеріссіз қалдырылды; қайталанған жүктемелер өткізіліп жіберілді.",
        }.get(language, "Старые файлы оставлены без изменений; новые дубликаты пропущены.")
    elif len(selected_replace) == len(items):
        confirmation_text = {
            "ru": "Выбор подтверждён. Старые файлы будут заменены.",
            "en": "Choices confirmed. Existing files will be replaced.",
            "kz": "Таңдау расталды. Ескі файлдар ауыстырылады.",
        }.get(language, "Выбор подтверждён. Старые файлы будут заменены.")
    else:
        confirmation_text = {
            "ru": "Выбор подтверждён. Будут заменены только файлы, для которых выбрано «Заменить»; остальные останутся без изменений.",
            "en": "Choices confirmed. Only files marked Replace will be replaced; the others will remain unchanged.",
            "kz": "Таңдау расталды. Тек «Ауыстыру» таңдалған файлдар ауыстырылады, қалғандары өзгеріссіз қалады.",
        }.get(language, "Выбор подтверждён. Будут заменены только файлы, для которых выбрано «Заменить»; остальные останутся без изменений.")
    await call.answer(confirmation_text, show_alert=True)
    if call.message:
        try: await call.message.delete()
        except Exception: log.debug("Could not delete duplicate confirmation message", exc_info=True)
    try:
        replace_norms = {item["norm"] for item in selected_replace}
        replace_ids: dict[str, set[int]] = {}
        replace_paths: dict[str, set[str]] = {}
        for item in selected_replace:
            norm = item["norm"]
            conflict_key = item.get("conflict_norm", norm)
            conflict = pending["conflicts"].get(conflict_key, {})
            replace_ids.setdefault(norm, set()).update(int(value) for value in conflict.get("ids", set()))
            replace_paths.setdefault(norm, set()).update(str(value) for value in conflict.get("paths", set()))
        first_replace_index = {}
        for item in selected_replace: first_replace_index.setdefault(item["norm"], int(item["index"]))
        filtered_files = []
        skipped_files = []
        for index, item in enumerate(pending["files"]):
            conflict = next((x for x in items if int(x["index"]) == index), None)
            if conflict:
                choice = choices.get(index, choices.get(str(index)))
                if choice == "keep":
                    skipped_files.append(item)
                    continue
                if first_replace_index.get(conflict["norm"]) != index:
                    skipped_files.append(item)
                    continue
            filtered_files.append(item)
        PENDING_BATCHES.pop(token, None)
        for skipped in skipped_files:
            try:
                path = skipped.get("path")
                if path and Path(path).is_file() and Path(path).resolve().is_relative_to(settings.data_dir.resolve()):
                    Path(path).unlink()
            except Exception:
                log.exception("Could not clean skipped duplicate upload %r", skipped.get("path"))
        if filtered_files:
            await _process_batch_files(bot, int(call.from_user.id), filtered_files, language,
                replace_names=replace_norms, replace_paths=replace_paths, replace_ids=replace_ids)
        # If all conflicting uploads were kept/skipped, the result was already
        # reported in the single callback alert above. Do not send another message.
    except Exception:
        log.exception("Applying per-file duplicate choices failed tg_id=%s", call.from_user.id)
        try: await bot.send_message(call.from_user.id, {"ru": "Не удалось применить выбранные действия. Старые файлы сохранены.", "en": "Could not apply the selected actions. Existing files were preserved.", "kz": "Таңдалған әрекеттерді қолдану мүмкін болмады. Ескі файлдар сақталды."}.get(language, "Не удалось применить выбранные действия. Старые файлы сохранены."))
        except Exception: log.exception("Could not report duplicate choice failure")
