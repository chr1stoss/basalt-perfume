from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *
from bot.handlers.common.keyboards.subscription import subscription_keyboard
from bot.handlers.common.messages.language import get_language_or_default
from bot.handlers.common.messages.views import show_view

async def show_subscription(bot: Bot, chat_id: int, tg_id: int, language: str | None = None):
    language = normalize_language(language or await get_language_or_default(tg_id))
    try:
        async with pool().acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT MAX(available_until) FROM subscription_keys "
                    "WHERE used_by_tg_id=%s AND is_frozen=0 AND available_until>NOW()",
                    (tg_id,),
                )
                row = await cur.fetchone()
        until = row[0] if row else None
    except Exception:
        log.exception("Could not read subscription state for tg_id=%s", tg_id)
        until = None
    if until:
        date_text = until.strftime("%d.%m.%Y %H:%M") if hasattr(until, "strftime") else str(until)
        body = tr(language, "subscription_title") + "\n\n" + tr(language, "subscription_active_until", date=escape_html(date_text))
    else:
        body = tr(language, "subscription_title") + "\n\n" + tr(language, "subscription_inactive")
    return await show_view(bot, chat_id, tg_id, image_for(language, "main"), body, subscription_keyboard(language))
