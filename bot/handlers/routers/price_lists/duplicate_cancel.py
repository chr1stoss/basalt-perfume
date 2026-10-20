from aiogram import Router
from bot.handlers.common import *

router = Router(name="basalt-duplicate-cancel")

@router.callback_query(F.data.startswith("cancel_choices:"))
async def cancel_duplicate_file_choices(call: CallbackQuery, bot: Bot):
    language = await get_language_or_default(call.from_user.id)
    token = call.data.split(":", 1)[1]
    pending = PENDING_BATCHES.get(token)
    if not pending or int(pending.get("tg_id", 0)) != int(call.from_user.id):
        await call.answer(tr(language, "expired_confirmation"), show_alert=True)
        return
    PENDING_BATCHES.pop(token, None)
    await call.answer({"ru": "Группа отменена. Данные не будут изменены.", "en": "Batch cancelled. No data will be changed.", "kz": "Топтан бас тартылды. Деректер өзгертілмейді."}.get(language, "Группа отменена. Данные не будут изменены."), show_alert=True)
    for item in pending.get("files", []):
        try:
            path = item.get("path")
            if path and Path(path).is_file() and Path(path).resolve().is_relative_to(settings.data_dir.resolve()):
                Path(path).unlink()
        except Exception:
            log.exception("Could not clean cancelled incoming file %r", item.get("path"))
    if call.message:
        try: await call.message.delete()
        except Exception: log.debug("Could not delete cancelled batch prompt", exc_info=True)
