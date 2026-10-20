from aiogram import Router
from bot.handlers.common import *

router = Router(name="basalt-commands")

@router.message(Command("subscribe"))
async def subscribe_command(message: Message, state: FSMContext, bot: Bot):
    await delete_user_message(message)
    await state.clear()
    await upsert_user(message.from_user)
    await show_subscription(bot, message.chat.id, message.from_user.id)

@router.message(Command("activate"))
async def activate_command(message: Message, state: FSMContext, bot: Bot):
    await delete_user_message(message)
    await upsert_user(message.from_user)
    language = await get_language_or_default(message.from_user.id)
    await state.set_state(Activation.waiting_key)
    chat_id, message_id = await show_view(
        bot,
        message.chat.id,
        message.from_user.id,
        image_for(language, "activation"),
        tr(language, "activation_title") + "\n\n" + tr(language, "activation_prompt"),
        back_keyboard(language),
    )
    await state.update_data(menu_chat_id=chat_id, menu_message_id=message_id)
