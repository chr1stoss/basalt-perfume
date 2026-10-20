from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *

async def get_language_or_default(tg_id: int) -> str:
    try:
        return normalize_language(await get_user_language(tg_id))
    except Exception:
        log.exception("Could not read Telegram language for tg_id=%s", tg_id)
        return "ru"
