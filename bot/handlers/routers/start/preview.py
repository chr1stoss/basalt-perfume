from aiogram import Router
from bot.handlers.common import *

router = Router(name="basalt-preview")

@router.message(Command("test"))
async def test_preview_command(message: Message, bot: Bot):
    """Open a read-only visual role preview in the WebApp for administrators."""
    if not message.from_user or int(message.from_user.id) not in settings.admin_ids:
        schedule_delete_user_message(message)
        return
    base_url = str(settings.webapp_url or "").strip()
    if not base_url.startswith("https://"):
        await message.answer(tr(await get_language_or_default(message.from_user.id), "webapp_https_missing"))
        schedule_delete_user_message(message)
        return
    preview_url = base_url + ("&" if "?" in base_url else "?") + "preview=1"
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text=tr(await get_language_or_default(message.from_user.id), "preview_button"), web_app=WebAppInfo(url=preview_url))
    ]])
    await message.answer(
        tr(await get_language_or_default(message.from_user.id), "preview_prompt"),
        reply_markup=keyboard,
    )
    schedule_delete_user_message(message)
