import logging
from aiogram.types import User
from bot.database.connection import pool

log = logging.getLogger(__name__)
_menu_persistence_available = None

async def upsert_user(user: User):
    async with pool().acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("INSERT INTO users(tg_id,username,first_name,last_name) VALUES(%s,%s,%s,%s) ON DUPLICATE KEY UPDATE username=%s,first_name=%s,last_name=%s", (user.id,user.username,user.first_name,user.last_name,user.username,user.first_name,user.last_name))
            lang = (user.language_code or 'ru').lower()[:2]
            if lang == 'kk': lang = 'kz'
            if lang not in ('ru','en','kz'): lang = 'ru'
            await cur.execute('INSERT INTO user_settings(tg_id,language) VALUES(%s,%s) ON DUPLICATE KEY UPDATE tg_id=tg_id', (user.id,lang))
        await conn.commit()

async def get_user_language(tg_id: int) -> str:
    async with pool().acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute('SELECT language FROM user_settings WHERE tg_id=%s', (tg_id,))
            row=await cur.fetchone()
            return row[0] if row and row[0] in ('ru','en','kz') else 'ru'

async def has_active_subscription(tg_id: int) -> bool:
    async with pool().acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute('SELECT 1 FROM subscription_keys WHERE used_by_tg_id=%s AND available_until>NOW() AND is_frozen=0 ORDER BY activated_at DESC,id DESC LIMIT 1',(tg_id,))
            return bool(await cur.fetchone())


async def set_user_language(tg_id: int, language: str) -> str:
    """Persist a language explicitly selected by the user from a deep link."""
    lang = (language or 'ru').lower()
    if lang == 'kk':
        lang = 'kz'
    if lang not in ('ru', 'en', 'kz'):
        lang = 'ru'
    async with pool().acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute('INSERT INTO user_settings(tg_id,language) VALUES(%s,%s) ON DUPLICATE KEY UPDATE tg_id=tg_id', (int(tg_id), lang))
            await cur.execute('UPDATE user_settings SET language=%s WHERE tg_id=%s', (lang, int(tg_id)))
        await conn.commit()
    return lang


async def get_saved_menu_message(tg_id: int):
    """Return a persisted (chat_id, message_id) menu reference when migration 07 is installed.

    Menu persistence is optional during rolling upgrades. A missing column disables this
    feature for the current process but does not prevent normal bot operation.
    """
    global _menu_persistence_available
    if _menu_persistence_available is False:
        return None
    try:
        async with pool().acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT menu_chat_id,menu_message_id FROM user_settings WHERE tg_id=%s",
                    (int(tg_id),),
                )
                row = await cur.fetchone()
        _menu_persistence_available = True
        if row and row[0] is not None and row[1] is not None:
            return int(row[0]), int(row[1])
        return None
    except Exception as exc:
        message = str(exc).lower()
        if "unknown column" in message or (getattr(exc, "args", ()) and exc.args[0] == 1054):
            _menu_persistence_available = False
            log.warning("Persistent Telegram menu is disabled until SQL patch 07_persistent_bot_menu.sql is applied")
        else:
            log.exception("Could not read persistent Telegram menu tg_id=%s", tg_id)
        return None


async def save_menu_message(tg_id: int, chat_id: int, message_id: int):
    """Persist the latest menu message so language changes still edit it after restart."""
    global _menu_persistence_available
    if _menu_persistence_available is False:
        return
    try:
        async with pool().acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "INSERT INTO user_settings(tg_id,language) VALUES(%s,'ru') ON DUPLICATE KEY UPDATE tg_id=tg_id",
                    (int(tg_id),),
                )
                await cur.execute(
                    "UPDATE user_settings SET menu_chat_id=%s,menu_message_id=%s WHERE tg_id=%s",
                    (int(chat_id), int(message_id), int(tg_id)),
                )
            await conn.commit()
        _menu_persistence_available = True
    except Exception as exc:
        message = str(exc).lower()
        if "unknown column" in message or (getattr(exc, "args", ()) and exc.args[0] == 1054):
            _menu_persistence_available = False
            log.warning("Persistent Telegram menu is disabled until SQL patch 07_persistent_bot_menu.sql is applied")
        else:
            log.exception("Could not save persistent Telegram menu tg_id=%s chat_id=%s message_id=%s", tg_id, chat_id, message_id)


async def get_user_role(tg_id: int) -> str:
    """Role used by bot-side upload enforcement; configured ADMIN_IDS always win."""
    from bot.config import settings
    if int(tg_id) in settings.admin_ids:
        return "admin"
    async with pool().acquire() as conn:
        async with conn.cursor() as cur:
            try:
                await cur.execute("SELECT role FROM users WHERE tg_id=%s LIMIT 1", (int(tg_id),))
                row = await cur.fetchone()
            except Exception as exc:
                if getattr(exc, "args", ()) and exc.args[0] == 1054:
                    return "none"  # fail closed until the role migration is applied
                raise
    role = row[0] if row else "none"
    return role if role in ("admin", "seller", "buyer", "none") else "none"
