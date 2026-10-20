from aiogram import Router
from bot.handlers.common import *

router = Router(name="basalt-entry")

@router.message(CommandStart())
async def start(message: Message, state: FSMContext, bot: Bot):
    response_sent = False
    try:
        await state.clear()
        payload = (message.text or "").partition(" ")[2].strip()

        # Render the complete /start menu once. The previous two-stage path sent a
        # placeholder and then edited its caption in a background task, which caused
        # Telegram to label the fresh message as edited and exposed task-tracking bugs.
        if not payload or payload.lower() in ("webapp", "open", "menu"):
            language = normalize_language(getattr(message.from_user, "language_code", None) or "ru")
            try:
                await upsert_user(message.from_user)
            except Exception:
                # Continue to a usable menu even if refreshing the user's profile fails.
                log.exception("Could not upsert user on normal /start: tg_id=%s", message.from_user.id)
            try:
                language = await get_language_or_default(message.from_user.id)
                body = await menu_body(message.from_user.id, language)
                role = await get_user_role(message.from_user.id)
            except Exception:
                # Database/profile lookup failures should not stop a basic menu reply.
                log.exception("Could not build personalized /start menu tg_id=%s", message.from_user.id)
                body = tr(language, "main_title") + "\n\n" + tr(language, "open_webapp")
                role = "buyer"
            await show_view(
                bot, message.chat.id, message.from_user.id, image_for(language, "main"),
                body, main_keyboard(language, role), reuse_main=False,
            )
            response_sent = True
            schedule_delete_user_message(message)
            log.info("/start menu sent tg_id=%s", message.from_user.id)
            return

        try:
            await upsert_user(message.from_user)
        except Exception:
            log.exception("Could not upsert user on /start: tg_id=%s", message.from_user.id)
        language = await get_language_or_default(message.from_user.id)

        # Explicit deep-link for changing Telegram bot language from WebApp settings.
        switch = re.fullmatch(r"switch_lang_(ru|en|kz)", payload, flags=re.IGNORECASE) if payload else None
        if switch:
            language = await set_user_language(message.from_user.id, switch.group(1).lower())
            body = await menu_body(message.from_user.id, language)
            await show_view(bot, message.chat.id, message.from_user.id, image_for(language, "main"), body, main_keyboard(language, await get_user_role(message.from_user.id)))
            response_sent = True
            schedule_delete_user_message(message)
            await send_notice(bot, message.chat.id, message.from_user.id, tr(language, "language_applied"), "", language, ttl=25)
            return

        if payload and payload.lower() == "subscribe":
            await show_subscription(bot, message.chat.id, message.from_user.id, language)
            response_sent = True
            schedule_delete_user_message(message)
            return

        admin_download_all_match = re.fullmatch(r"admin_download_all_(\d+)", payload, flags=re.IGNORECASE) if payload else None
        if admin_download_all_match:
            if not await is_admin(int(message.from_user.id)):
                await message.answer(tr(language, "admin_only"))
            else:
                target_id = int(admin_download_all_match.group(1))
                await send_all_downloads(bot, message.chat.id, message.from_user.id, language, owner_tg_id=target_id)
            response_sent = True
            schedule_delete_user_message(message)
            return

        admin_download_match = re.fullmatch(r"admin_download_(\d+)_(\d+)", payload, flags=re.IGNORECASE) if payload else None
        if admin_download_match:
            if not await is_admin(int(message.from_user.id)):
                await message.answer(tr(language, "admin_only"))
            else:
                target_id = int(admin_download_match.group(1))
                price_list_id = int(admin_download_match.group(2))
                async with pool().acquire() as conn:
                    async with conn.cursor() as cur:
                        await cur.execute("SELECT filename,filepath,status FROM price_lists WHERE id=%s AND owner_tg_id=%s LIMIT 1", (price_list_id, target_id))
                        file_row = await cur.fetchone()
                if not file_row:
                    await send_notice(bot, message.chat.id, message.from_user.id, tr(language, "download_not_found_title"), tr(language, "download_not_found_body"), language)
                else:
                    try:
                        await send_one_download(bot, message.chat.id, message.from_user.id, file_row, language)
                    except Exception:
                        log.exception("Admin download failed price_list_id=%s owner_tg_id=%s", price_list_id, target_id)
                        await send_notice(bot, message.chat.id, message.from_user.id, tr(language, "download_failed_title"), tr(language, "download_failed_body"), language)
            response_sent = True
            schedule_delete_user_message(message)
            return

        if payload and payload.lower() == "download_all":
            if not await has_active_subscription(message.from_user.id):
                await show_view(bot, message.chat.id, message.from_user.id, image_for(language, "main"),
                    tr(language, "need_subscription_title") + "\n\n" + tr(language, "need_subscription_upload"), subscription_keyboard(language))
            else:
                await send_all_downloads(bot, message.chat.id, message.from_user.id, language)
            response_sent = True
            schedule_delete_user_message(message)
            return

        download_match = re.fullmatch(r"download_(\d+)", payload, flags=re.IGNORECASE) if payload else None
        if download_match:
            if not await has_active_subscription(message.from_user.id):
                await show_view(bot, message.chat.id, message.from_user.id, image_for(language, "main"),
                    tr(language, "need_subscription_title") + "\n\n" + tr(language, "need_subscription_upload"), subscription_keyboard(language))
                response_sent = True
                schedule_delete_user_message(message)
                return
            price_list_id = int(download_match.group(1))
            async with pool().acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute("SELECT filename,filepath,status FROM price_lists WHERE id=%s AND owner_tg_id=%s LIMIT 1", (price_list_id, message.from_user.id))
                    file_row = await cur.fetchone()
            if not file_row:
                await send_notice(bot, message.chat.id, message.from_user.id, tr(language, "download_not_found_title"), tr(language, "download_not_found_body"), language)
            else:
                try:
                    await send_one_download(bot, message.chat.id, message.from_user.id, file_row, language)
                except Exception:
                    log.exception("Could not send price list id=%s to tg_id=%s", price_list_id, message.from_user.id)
                    await send_notice(bot, message.chat.id, message.from_user.id, tr(language, "download_failed_title"), tr(language, "download_failed_body"), language)
            response_sent = True
            schedule_delete_user_message(message)
            return

        # Legacy start payloads containing an activation key are still supported.
        if payload and payload.lower() not in ("webapp", "open", "menu"):
            ok, reason = await activate_key(message.from_user.id, payload, language)
            response_sent = True
            if ok:
                # Once the transaction confirms activation, never report a false failure
                # because rendering/editing the menu later throws an unrelated exception.
                await send_notice(bot, message.chat.id, message.from_user.id, tr(language, "key_success_title"), reason, language)
                try:
                    body = await menu_body(message.from_user.id, language)
                    await show_view(bot, message.chat.id, message.from_user.id, image_for(language, "main"), body, main_keyboard(language, await get_user_role(message.from_user.id)))
                except Exception:
                    log.exception("Key activation succeeded but /start menu refresh failed for tg_id=%s", message.from_user.id)
            else:
                try:
                    await show_view(bot, message.chat.id, message.from_user.id, image_for(language, "activation"),
                        tr(language, "activation_title") + "\n\n" + tr(language, "activation_prompt"), back_keyboard(language))
                except Exception:
                    log.exception("Could not restore activation prompt for tg_id=%s", message.from_user.id)
                await send_notice(bot, message.chat.id, message.from_user.id, tr(language, "key_bad_title"), reason, language)
            schedule_delete_user_message(message)
            return

        body = await menu_body(message.from_user.id, language)
        await show_view(bot, message.chat.id, message.from_user.id, image_for(language, "main"), body, main_keyboard(language, await get_user_role(message.from_user.id)))
        response_sent = True
        schedule_delete_user_message(message)
    except Exception:
        log.exception("Failed to process /start for tg_id=%s", message.from_user.id)
        if not response_sent:
            try:
                language = await get_language_or_default(message.from_user.id)
                sent = await bot.send_message(
                    chat_id=message.chat.id,
                    text=tr(language, "main_title") + "\n\n" + tr(language, "start_failed_body"),
                    reply_markup=main_keyboard(language, await get_user_role(message.from_user.id)),
                    parse_mode="HTML",
                )
                MAIN_MESSAGES[int(message.from_user.id)] = (int(message.chat.id), int(sent.message_id))
                schedule_delete_user_message(message)
            except Exception:
                log.exception("Could not send fallback /start response to tg_id=%s", message.from_user.id)
