from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *

_background_tasks: set[asyncio.Task] = set()

async def delete_user_message(message: Message):
    try:
        await message.delete()
    except TelegramBadRequest as exc:
        text = str(exc).lower()
        if any(marker in text for marker in ("message to delete not found", "message_id_invalid", "message identifier is not specified", "message can't be deleted", "message can\'t be deleted", "too late")):
            log.debug("Incoming Telegram message already gone/unavailable: chat_id=%s message_id=%s", message.chat.id, message.message_id)
        else:
            log.warning("Could not delete incoming Telegram message chat_id=%s message_id=%s: %s", message.chat.id, message.message_id, exc)
    except Exception:
        log.exception("Unexpected error while deleting incoming Telegram message chat_id=%s message_id=%s", message.chat.id, message.message_id)

def schedule_delete_user_message(message: Message):
    """Delete a command without making the visible reply wait for Telegram's delete call."""
    task = asyncio.create_task(delete_user_message(message), name=f"delete-command-{message.message_id}")
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
