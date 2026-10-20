from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *

async def photo_message(bot: Bot, chat_id: int, caption: str, reply_markup=None, image: Path | None = None):
    image_path = image or MAIN_IMAGE
    if not image_path.is_file():
        log.error("Bot UI image is missing: %s", image_path)
        image_path = LOGO
    return await bot.send_photo(
        chat_id=chat_id,
        photo=FSInputFile(str(image_path)),
        caption=caption,
        reply_markup=reply_markup,
        parse_mode="HTML",
    )

async def edit_view(bot: Bot, chat_id: int, message_id: int, image: Path, caption: str, reply_markup=None) -> bool:
    """Edit the existing persistent menu, including its photo, caption and keyboard."""
    media_path = image if image.is_file() else LOGO
    try:
        await bot.edit_message_media(
            chat_id=chat_id,
            message_id=message_id,
            media=InputMediaPhoto(media=FSInputFile(str(media_path)), caption=caption, parse_mode="HTML"),
            reply_markup=reply_markup,
        )
        return True
    except TelegramBadRequest as exc:
        text = str(exc).lower()
        if "message is not modified" in text:
            # A no-op edit is a success from the user's point of view.
            return True
        # Never treat a caption-only edit as success: the user explicitly expects the
        # screen image to change too. The caller will send the full replacement screen.
        log.debug("Could not edit Telegram menu media; replace the whole message chat_id=%s message_id=%s: %s", chat_id, message_id, exc)
    except Exception:
        log.exception("Unexpected failure editing Telegram menu media chat_id=%s message_id=%s", chat_id, message_id)
    return False
