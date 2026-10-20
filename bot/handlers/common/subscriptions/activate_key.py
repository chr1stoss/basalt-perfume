from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *

async def activate_key(tg_id: int, key: str, language="ru"):
    key = key.strip()
    # Lifetime admin keys are only valid for Telegram IDs explicitly configured by the operator.
    if key.upper().startswith("ADMIN-LIFETIME-") and int(tg_id) not in settings.admin_ids:
        return False, tr(language, "key_bad_body")
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    async with pool().acquire() as conn:
        async with conn.cursor() as cur:
            await conn.begin()
            try:
                await cur.execute(
                    "SELECT id,duration_days,usable,used_by_tg_id,owner_tg_id,role_on_activate FROM subscription_keys WHERE key_hash=%s FOR UPDATE",
                    (digest,),
                )
                row = await cur.fetchone()
                if not row:
                    await conn.rollback()
                    return False, tr(language, "key_bad_body")
                if len(row) >= 6:
                    key_id, days, usable, used_by, key_owner, role_on_activate = row
                else:  # Defensive compatibility for older database-test fixtures.
                    key_id, days, usable, used_by, key_owner = row
                    role_on_activate = None
                if key.upper().startswith("ADMIN-LIFETIME-") and int(key_owner or 0) != int(tg_id):
                    await conn.rollback()
                    return False, tr(language, "key_bad_body")
                if int(usable) != 1 or used_by is not None:
                    await conn.rollback()
                    return False, tr(language, "key_bad_body")
                await cur.execute(
                    "SELECT MAX(available_until) FROM subscription_keys "
                    "WHERE used_by_tg_id=%s AND is_frozen=0 AND available_until>NOW()",
                    (tg_id,),
                )
                active = await cur.fetchone()
                until = active[0] if active else None
                if int(days) >= 365000:
                    await cur.execute(
                        "UPDATE subscription_keys SET used_by_tg_id=%s,usable=0,activated_at=NOW(),available_until='9999-12-31 23:59:59' WHERE id=%s",
                        (tg_id, key_id),
                    )
                else:
                    await cur.execute(
                        "UPDATE subscription_keys SET used_by_tg_id=%s,usable=0,activated_at=NOW(),"
                        "available_until=DATE_ADD(GREATEST(COALESCE(%s,NOW()),NOW()),INTERVAL duration_days DAY) WHERE id=%s",
                        (tg_id, until, key_id),
                    )
                target_role = str(role_on_activate or "").strip().lower()
                if target_role in {"buyer", "seller", "admin"}:
                    await cur.execute("SELECT role FROM users WHERE tg_id=%s FOR UPDATE", (tg_id,))
                    user_role_row = await cur.fetchone()
                    current_role = str((user_role_row[0] if user_role_row else "none") or "none").strip().lower()
                    if user_role_row and current_role == "none":
                        await cur.execute("UPDATE users SET role=%s WHERE tg_id=%s", (target_role, tg_id))
                        if target_role == "admin":
                            await cur.execute("INSERT IGNORE INTO admins(tg_id) VALUES(%s)", (tg_id,))
                await conn.commit()
                return True, tr(language, "key_success_body")
            except Exception:
                await conn.rollback()
                raise
