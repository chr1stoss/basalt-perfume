from aiogram import Router
from bot.handlers.common import *

router = Router(name="basalt-commands")

@router.message(Command("download_all"))
async def download_all_command(message: Message, bot: Bot):
    """Explicit command target for downloading all ready price lists."""
    await upsert_user(message.from_user)
    language = await get_language_or_default(message.from_user.id)
    if not await has_active_subscription(message.from_user.id):
        await show_view(bot, message.chat.id, message.from_user.id, image_for(language, "main"),
            tr(language, "need_subscription_title") + "\n\n" + tr(language, "need_subscription_upload"), subscription_keyboard(language))
    else:
        await send_all_downloads(bot, message.chat.id, message.from_user.id, language)
    schedule_delete_user_message(message)
