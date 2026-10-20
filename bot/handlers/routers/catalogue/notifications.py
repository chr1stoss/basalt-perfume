from aiogram import Router
from bot.handlers.common import *

router = Router(name="basalt-notifications")

@router.callback_query(F.data == "dismiss_notice")
async def dismiss_notice(call: CallbackQuery, bot: Bot):
    await call.answer()
    try:
        if call.message:
            await bot.delete_message(chat_id=call.message.chat.id, message_id=call.message.message_id)
    except TelegramBadRequest as exc:
        if not any(marker in str(exc).lower() for marker in ("message to delete not found", "message_id_invalid", "message identifier is not specified", "too late", "message can't be deleted", "message can\'t be deleted")):
            log.debug("Dismissed notice could not be deleted: %s", exc)
    except Exception:
        log.exception("Could not dismiss notice from tg_id=%s", call.from_user.id)

@router.callback_query(F.data.startswith("read:"))
async def mark_notification_read(call: CallbackQuery, bot: Bot):
    language = await get_language_or_default(call.from_user.id)
    try:
        notification_id = int(call.data.split(":", 1)[1])
    except (ValueError, AttributeError):
        await call.answer(tr(language, "notification_not_found"), show_alert=True)
        return
    chat_id = call.message.chat.id if call.message else call.from_user.id
    message_id = call.message.message_id if call.message else None
    if message_id is not None:
        try:
            await bot.delete_message(chat_id=chat_id, message_id=message_id)
        except TelegramBadRequest as exc:
            # A message already removed by auto-cleanup is considered read as well.
            text = str(exc).lower()
            if not any(marker in text for marker in ("message to delete not found", "message_id_invalid", "message identifier is not specified", "message can't be deleted", "message can\'t be deleted", "too late")):
                log.warning("Telegram notification delete failed chat_id=%s message_id=%s: %s", chat_id, message_id, exc)
                await call.answer(tr(language, "delete_retry"), show_alert=True)
                return
        except Exception:
            log.exception("Unexpected notification delete failure chat_id=%s message_id=%s", chat_id, message_id)
            await call.answer(tr(language, "delete_retry"), show_alert=True)
            return
    try:
        async with pool().acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("UPDATE app_notifications SET is_read=1 WHERE id=%s AND tg_id=%s", (notification_id, call.from_user.id))
                if message_id is not None:
                    await cur.execute("DELETE FROM telegram_message_cleanup WHERE chat_id=%s AND message_id=%s", (chat_id, message_id))
            await conn.commit()
    except Exception:
        log.exception("Telegram notification was deleted but its read state could not be saved for tg_id=%s", call.from_user.id)
        await call.answer(tr(language, "message_removed_status_pending"), show_alert=True)
        return
    await call.answer()
