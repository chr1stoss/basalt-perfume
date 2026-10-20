from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *

async def is_admin(tg_id: int) -> bool:
    if tg_id in settings.admin_ids:
        return True
    try:
        async with pool().acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT 1 FROM admins WHERE tg_id=%s UNION SELECT 1 FROM users WHERE tg_id=%s AND role='admin' LIMIT 1",
                    (tg_id, tg_id),
                )
                return bool(await cur.fetchone())
    except Exception:
        log.exception("Admin lookup failed for tg_id=%s", tg_id)
        return False
