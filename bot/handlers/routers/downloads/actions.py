from aiogram import Router
from bot.handlers.common import *

router = Router(name="basalt-actions")

@router.callback_query(F.data == "delete_download_message")
async def delete_download_message(call: CallbackQuery, bot: Bot):
    await call.answer()
    try:
        if call.message:
            await bot.delete_message(chat_id=call.message.chat.id, message_id=call.message.message_id)
    except TelegramBadRequest as exc:
        text = str(exc).lower()
        if not any(marker in text for marker in ("message to delete not found", "message_id_invalid", "message identifier is not specified", "message can't be deleted", "message can\'t be deleted", "too late")):
            log.debug("Download message deletion skipped: %s", exc)
    except Exception:
        log.exception("Could not delete downloaded file message for tg_id=%s", call.from_user.id)

@router.callback_query(F.data.startswith("delete_download_group:"))
async def delete_download_group(call: CallbackQuery, bot: Bot):
    language = await get_language_or_default(call.from_user.id)
    token = call.data.split(":", 1)[1]
    group = DOWNLOAD_GROUPS.get(token)
    if not group or int(group.get("tg_id", 0)) != int(call.from_user.id):
        await call.answer(tr(language, "expired_confirmation"), show_alert=True)
        return
    await call.answer()
    # Reply early so a large album cannot time out the callback query.
    for message_id in [*group.get("album_message_ids", []), group.get("control_message_id")]:
        if not message_id:
            continue
        try:
            await bot.delete_message(chat_id=int(group["chat_id"]), message_id=int(message_id))
        except asyncio.CancelledError:
            raise
        except TelegramBadRequest as exc:
            if not any(marker in str(exc).lower() for marker in ("message to delete not found", "message_id_invalid", "message identifier is not specified", "too late", "message can't be deleted", "message can\'t be deleted")):
                log.warning("Could not delete bulk download message chat_id=%s message_id=%s: %s", group["chat_id"], message_id, exc)
        except Exception:
            log.exception("Unexpected bulk download deletion error chat_id=%s message_id=%s", group.get("chat_id"), message_id)
    DOWNLOAD_GROUPS.pop(token, None)
