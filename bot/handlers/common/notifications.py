from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *
from bot.handlers.common.keyboards.download_group import notice_keyboard

async def send_notice(bot: Bot, chat_id: int, tg_id: int, title: str, body: str, language="ru", ttl=NOTICE_TTL_SECONDS):
    try:
        sent = await bot.send_message(
            chat_id=chat_id,
            text=title + ("\n\n" + body if body else ""),
            reply_markup=notice_keyboard(language),
            parse_mode="HTML",
        )
        if ttl > 0:
            task = asyncio.create_task(_delete_message_after(bot, chat_id, sent.message_id, ttl), name="ephemeral-notice-delete")
            _background_tasks.add(task)
            task.add_done_callback(_background_tasks.discard)
        return sent
    except Exception:
        log.exception("Could not send short-lived notice to tg_id=%s", tg_id)
        return None

async def _delete_message_after(bot: Bot, chat_id: int, message_id: int, delay: float):
    """Delete a transient DM no more than twice; never spin on stale Telegram IDs."""
    await asyncio.sleep(delay)
    terminal_markers = (
        "message to delete not found", "message_id_invalid", "message identifier is not specified",
        "message can't be deleted", "message can\'t be deleted", "too late",
    )
    for attempt in range(1, 3):
        try:
            await bot.delete_message(chat_id=chat_id, message_id=message_id)
            return
        except asyncio.CancelledError:
            raise
        except TelegramBadRequest as exc:
            text = str(exc).lower()
            if any(marker in text for marker in terminal_markers):
                log.debug("Ephemeral message already gone/unavailable chat_id=%s message_id=%s: %s", chat_id, message_id, exc)
                return
            if attempt >= 2:
                log.warning("Abandoning ephemeral delete after %s attempts chat_id=%s message_id=%s: %s", attempt, chat_id, message_id, exc)
                return
            log.warning("Ephemeral delete failed (%s/2), retrying once chat_id=%s message_id=%s: %s", attempt, chat_id, message_id, exc)
        except Exception:
            if attempt >= 2:
                log.exception("Abandoning ephemeral delete after %s attempts chat_id=%s message_id=%s", attempt, chat_id, message_id)
                return
            log.exception("Ephemeral delete failed (%s/2), retrying once chat_id=%s message_id=%s", attempt, chat_id, message_id)
        await asyncio.sleep(1.0)
