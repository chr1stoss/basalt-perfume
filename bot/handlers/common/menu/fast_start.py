from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *
from bot.handlers.common.runtime import _background_tasks
from bot.handlers.common.keyboards.main import main_keyboard
from bot.handlers.common.menu.body import menu_body
from bot.handlers.common.messages.language import get_language_or_default

async def _finish_fast_start_menu(bot: Bot, user, chat_id: int, message_id: int, is_photo: bool):
    """Enrich the already-visible /start menu after slow database work."""
    tg_id = int(user.id)
    try:
        old_menu = await get_saved_menu_message(tg_id)
        await upsert_user(user)
        language = await get_language_or_default(tg_id)
        role = await get_user_role(tg_id)
        body = await menu_body(tg_id, language)
        try:
            if is_photo:
                await bot.edit_message_caption(
                    chat_id=chat_id, message_id=message_id, caption=body,
                    reply_markup=main_keyboard(language, role), parse_mode="HTML",
                )
            else:
                await bot.edit_message_text(
                    chat_id=chat_id, message_id=message_id, text=body,
                    reply_markup=main_keyboard(language, role), parse_mode="HTML",
                )
        except Exception:
            log.exception("Could not localize/enrich fast /start menu tg_id=%s", tg_id)
        MAIN_MESSAGES[tg_id] = (int(chat_id), int(message_id))
        await save_menu_message(tg_id, int(chat_id), int(message_id))
        if old_menu and (int(old_menu[0]), int(old_menu[1])) != (int(chat_id), int(message_id)):
            try:
                await bot.delete_message(chat_id=int(old_menu[0]), message_id=int(old_menu[1]))
            except Exception:
                log.debug("Could not delete stale menu after fast /start tg_id=%s", tg_id, exc_info=True)
    except Exception:
        # The instant menu was already sent, so a database failure must not remove it.
        log.exception("Background /start enrichment failed tg_id=%s", tg_id)

def schedule_fast_start_enrichment(bot: Bot, user, chat_id: int, message_id: int, is_photo: bool):
    task = asyncio.create_task(
        _finish_fast_start_menu(bot, user, chat_id, message_id, is_photo),
        name=f"finish-start-menu-{user.id}",
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
