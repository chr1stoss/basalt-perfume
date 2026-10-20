from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *

async def menu_body(tg_id: int, language: str) -> str:
    try:
        active = await has_active_subscription(tg_id)
    except Exception:
        log.exception("Subscription check failed for tg_id=%s", tg_id)
        active = False
    role = await get_user_role(tg_id)
    role_hint = {
        "ru": "Вам доступен поиск товаров в каталоге WebApp. Загрузка прайс-листов отключена.",
        "en": "Product search is available in the WebApp catalogue. Price-list uploads are disabled.",
        "kz": "WebApp каталогында тауар іздеу қолжетімді. Прайс-парақ жүктеу өшірілген.",
    } if role == "buyer" else ({
        "ru": "Для доступа активируйте или продлите подписку в боте.",
        "en": "Activate or renew your subscription in the bot to get access.",
        "kz": "Қолжетімділік үшін ботта жазылымды іске қосыңыз немесе ұзартыңыз.",
    } if role == "none" else None)
    hint = role_hint.get(language, role_hint.get("ru", "")) if role_hint else tr(language, "upload_hint")
    return tr(language, "main_title") + "\n\n" + tr(language, "welcome_active" if active else "welcome_inactive") + "\n\n" + hint
