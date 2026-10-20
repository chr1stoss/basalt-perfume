from aiogram import Router
from bot.handlers.common import *

router = Router(name="basalt-activation")

@router.callback_query(F.data == "activate")
async def activate_callback(call: CallbackQuery, state: FSMContext):
    language = await get_language_or_default(call.from_user.id)
    await state.set_state(Activation.waiting_key)
    if call.message:
        await state.update_data(menu_chat_id=call.message.chat.id, menu_message_id=call.message.message_id)
    await call.answer()
    await show_call_view(call, image_for(language, "activation"), tr(language, "activation_title") + "\n\n" + tr(language, "activation_prompt"), back_keyboard(language))
    target = MAIN_MESSAGES.get(int(call.from_user.id))
    if target:
        await state.update_data(menu_chat_id=int(target[0]), menu_message_id=int(target[1]))

@router.message(Activation.waiting_key, F.text)
async def receive_key(message: Message, state: FSMContext, bot: Bot):
    key = (message.text or "").strip()
    await delete_user_message(message)
    language = await get_language_or_default(message.from_user.id)
    if len(key) < 8 or len(key) > 100:
        await send_notice(bot, message.chat.id, message.from_user.id, tr(language, "key_bad_title"), tr(language, "key_bad_body"), language)
        return
    try:
        ok, reason = await activate_key(message.from_user.id, key, language)
    except Exception:
        log.exception("Activation request failed for tg_id=%s", message.from_user.id)
        await send_notice(bot, message.chat.id, message.from_user.id, tr(language, "unexpected_error_title"), tr(language, "unexpected_error_body"), language)
        return
    data = await state.get_data()
    target_chat = int(data.get("menu_chat_id", message.chat.id))
    target_message = data.get("menu_message_id")
    if ok:
        await state.clear()
        # The key has been committed. Send only success for this result; errors in
        # updating an old menu must not trigger the global failure alert/message.
        await send_notice(bot, message.chat.id, message.from_user.id, tr(language, "key_success_title"), reason, language)
        try:
            body = await menu_body(message.from_user.id, language)
            role = await get_user_role(message.from_user.id)
            keyboard = main_keyboard(language, role)
            if target_message:
                edited = await edit_view(bot, target_chat, int(target_message), image_for(language, "main"), body, keyboard)
                if edited:
                    MAIN_MESSAGES[int(message.from_user.id)] = (target_chat, int(target_message))
                    await save_menu_message(int(message.from_user.id), target_chat, int(target_message))
                else:
                    sent = await photo_message(bot, target_chat, body, keyboard, image=image_for(language, "main"))
                    MAIN_MESSAGES[int(message.from_user.id)] = (target_chat, sent.message_id)
                    await save_menu_message(int(message.from_user.id), target_chat, int(sent.message_id))
            else:
                await show_view(bot, target_chat, message.from_user.id, image_for(language, "main"), body, keyboard)
        except Exception:
            log.exception("Key activation succeeded but post-activation menu refresh failed for tg_id=%s", message.from_user.id)
    else:
        # Native Telegram pop-up alerts can only be opened from callback queries.
        # The submitted key is a normal message, so use a short-lived notice with OK;
        # keep the persistent activation page and its Back button untouched.
        await send_notice(bot, message.chat.id, message.from_user.id, tr(language, "key_bad_title"), reason, language)
