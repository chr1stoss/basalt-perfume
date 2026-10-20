from aiogram import Router
from bot.handlers.common import *

router = Router(name="basalt-errors")

@router.error()
async def report_unhandled_error(event: ErrorEvent):
    update = getattr(event, "update", None)
    exception = getattr(event, "exception", None)
    log.error("Unhandled aiogram update error update_id=%s", getattr(update, "update_id", None),
              exc_info=(type(exception), exception, exception.__traceback__) if exception else None)
    try:
        callback = getattr(update, "callback_query", None) if update else None
        if callback:
            await callback.answer(tr(await get_language_or_default(callback.from_user.id), "action_failed"), show_alert=True)
        else:
            message = getattr(update, "message", None) if update else None
            if message and message.from_user:
                language = await get_language_or_default(message.from_user.id)
                await send_notice(message.bot, message.chat.id, message.from_user.id,
                                  tr(language, "unexpected_error_title"), tr(language, "unexpected_error_body"), language)
    except Exception:
        log.exception("Could not respond to an unhandled Telegram handler error")

@router.callback_query(F.data == "locked_noop")
async def locked_noop(call: CallbackQuery):
    """A disabled placeholder callback installed on locked inline keyboards."""
    try:
        await call.answer()
    except Exception:
        log.debug("Could not acknowledge inert callback", exc_info=True)
