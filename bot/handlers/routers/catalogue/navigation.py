from aiogram import Router
from bot.handlers.common import *

router = Router(name="basalt-navigation")

@router.callback_query(F.data == "how_upload")
async def how_upload(call: CallbackQuery, state: FSMContext):
    # This screen only explains the upload flow; it never enables or performs an upload.
    # Keep it public so a new user can learn the process before choosing a role/subscription.
    language = await get_language_or_default(call.from_user.id)
    await state.clear()
    await call.answer()
    await show_call_view(call, image_for(language, "upload"), tr(language, "how_upload_title") + "\n\n" + tr(language, "how_upload_body"), back_keyboard(language))

@router.callback_query(F.data == "home")
async def home_callback(call: CallbackQuery, state: FSMContext):
    language = await get_language_or_default(call.from_user.id)
    await state.clear()
    await call.answer()
    if call.message:
        body = await menu_body(call.from_user.id, language)
        await show_call_view(call, image_for(language, "main"), body, main_keyboard(language, await get_user_role(call.from_user.id)))
