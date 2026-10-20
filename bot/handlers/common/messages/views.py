from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *
from bot.handlers.common.messages.view_helpers import edit_view, photo_message

async def show_view(bot: Bot, chat_id: int, tg_id: int, image: Path, caption: str, keyboard, *, reuse_main=True):
    target = MAIN_MESSAGES.get(int(tg_id))
    if not target:
        # Load the saved menu even when reuse_main=False so a replacement can remove
        # the stale menu after the new message has been delivered successfully.
        target = await get_saved_menu_message(int(tg_id))
        if target:
            MAIN_MESSAGES[int(tg_id)] = target
    if reuse_main and target and int(target[0]) == int(chat_id):
        if await edit_view(bot, chat_id, target[1], image, caption, keyboard):
            ref = (int(chat_id), int(target[1]))
            MAIN_MESSAGES[int(tg_id)] = ref
            await save_menu_message(int(tg_id), *ref)
            return ref
    sent = await photo_message(bot, chat_id, caption, keyboard, image=image)
    ref = (int(chat_id), int(sent.message_id))
    MAIN_MESSAGES[int(tg_id)] = ref
    await save_menu_message(int(tg_id), *ref)
    if target and int(target[0]) == int(chat_id) and int(target[1]) != int(sent.message_id):
        try:
            await bot.delete_message(chat_id=int(chat_id), message_id=int(target[1]))
        except TelegramBadRequest as exc:
            text = str(exc).lower()
            if not any(marker in text for marker in ("message to delete not found", "message_id_invalid", "message identifier is not specified", "too late", "message can't be deleted", "message can\'t be deleted")):
                log.warning("Could not remove stale main menu chat_id=%s message_id=%s: %s", chat_id, target[1], exc)
        except Exception:
            log.exception("Could not remove stale main menu chat_id=%s message_id=%s", chat_id, target[1])
    return ref

async def show_call_view(call: CallbackQuery, image: Path, caption: str, keyboard):
    if not call.message:
        return False
    chat_id, message_id = int(call.message.chat.id), int(call.message.message_id)
    edited = await edit_view(call.bot, chat_id, message_id, image, caption, keyboard)
    if edited:
        MAIN_MESSAGES[int(call.from_user.id)] = (chat_id, message_id)
        await save_menu_message(int(call.from_user.id), chat_id, message_id)
        return True
    # Some legacy Telegram messages cannot have their media edited. Send the requested
    # screen first, then remove the old one so the user never loses the Back keyboard.
    sent = await photo_message(call.bot, chat_id, caption, keyboard, image=image)
    ref = (chat_id, int(sent.message_id))
    MAIN_MESSAGES[int(call.from_user.id)] = ref
    await save_menu_message(int(call.from_user.id), *ref)
    try:
        await call.bot.delete_message(chat_id=chat_id, message_id=message_id)
    except TelegramBadRequest as exc:
        if not any(marker in str(exc).lower() for marker in ("message to delete not found", "message_id_invalid", "message identifier is not specified", "too late", "message can't be deleted", "message can\'t be deleted")):
            log.warning("Could not remove replaced Telegram menu chat_id=%s message_id=%s: %s", chat_id, message_id, exc)
    except Exception:
        log.exception("Could not remove replaced Telegram menu chat_id=%s message_id=%s", chat_id, message_id)
    return True
