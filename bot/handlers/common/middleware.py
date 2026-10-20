"""Account-lock and maintenance middleware shared by all bot routes."""
from bot.handlers.common.deps import *
from bot.handlers.common.messages.cleanup import schedule_delete_user_message
from bot.handlers.common.admin import is_admin
from bot.handlers.common.middleware_keyboard import make_inline_keyboard_inert

class MaintenanceMiddleware(BaseMiddleware):
    """Block regular bot interactions during scheduled maintenance; administrators retain access."""
    async def __call__(self, handler, event, data):
        user = getattr(event, "from_user", None)
        if isinstance(event, Message):
            command_text = (event.text or event.caption or "").strip()
            if command_text.startswith("/"):
                command_name = command_text.split(None, 1)[0].split("@", 1)[0].lower()
                if command_name == "/test" and int(user.id if user else 0) not in settings.admin_ids:
                    schedule_delete_user_message(event)
                    return None
        if not user or await is_admin(int(user.id)):
            return await handler(event, data)
        try:
            async with pool().acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "SELECT setting_key,setting_value FROM app_settings "
                        "WHERE setting_key IN ('maintenance_mode','maintenance_title','maintenance_message','maintenance_until')"
                    )
                    rows = await cur.fetchall()
                    state = {str(row[0]): row[1] for row in rows}
                    enabled = str(state.get("maintenance_mode", "0")).strip().lower() in ("1", "true", "yes", "on")
                    until = state.get("maintenance_until")
                    if enabled and until:
                        try:
                            end_time = until if isinstance(until, datetime) else datetime.fromisoformat(str(until).replace("Z", "+00:00"))
                            # DB datetimes are normally naive and use server-local timezone.
                            if end_time.tzinfo is not None:
                                now = datetime.now(end_time.tzinfo)
                            else:
                                now = datetime.now()
                            if end_time <= now:
                                enabled = False
                                await cur.execute(
                                    "INSERT INTO app_settings(setting_key,setting_value) VALUES('maintenance_mode','0') "
                                    "ON DUPLICATE KEY UPDATE setting_value='0'"
                                )
                                await conn.commit()
                        except (TypeError, ValueError, OverflowError):
                            log.warning("Invalid maintenance end timestamp: %r", until)
                    if enabled:
                        title = str(state.get("maintenance_title") or "Технические работы")[:190]
                        message = str(state.get("maintenance_message") or "Сервис временно недоступен. Попробуйте позже.")[:3000]
                        until_text = ("\n\nОжидаемое завершение: " + str(until)) if until else ""
                        notice = title + "\n\n" + message + until_text
                        if isinstance(event, CallbackQuery):
                            await make_inline_keyboard_inert(event)
                            try:
                                await event.answer(notice[:190], show_alert=True)
                            except Exception:
                                log.debug("Unable to send maintenance callback alert tg_id=%s", user.id, exc_info=True)
                        elif isinstance(event, Message):
                            schedule_delete_user_message(event)
                            await event.answer(notice)
                        return None
        except Exception:
            # Fail closed: never process user commands while the maintenance gate cannot be checked.
            log.exception("Could not check maintenance mode for tg_id=%s; blocking the update", user.id)
            notice = "Сервис временно недоступен: не удалось проверить режим технических работ. Попробуйте позже."
            try:
                if isinstance(event, CallbackQuery):
                    await make_inline_keyboard_inert(event)
                    await event.answer(notice[:190], show_alert=True)
                elif isinstance(event, Message):
                    await event.answer(notice)
            except Exception:
                log.debug("Could not send maintenance-check failure notice to tg_id=%s", user.id, exc_info=True)
            return None
        return await handler(event, data)

class BannedCallbackMiddleware(BaseMiddleware):
    """Keep callback buttons inert for actively banned accounts; WebApp buttons are not callbacks."""
    async def __call__(self, handler, event, data):
        if isinstance(event, CallbackQuery) and event.from_user:
            tg_id = int(event.from_user.id)
            if tg_id not in settings.admin_ids:
                try:
                    async with pool().acquire() as conn:
                        async with conn.cursor() as cur:
                            await cur.execute(
                                "SELECT role,is_blocked,banned_until,ban_reason FROM users WHERE tg_id=%s LIMIT 1",
                                (tg_id,),
                            )
                            row = await cur.fetchone()
                            if row and row[0] != "admin" and row[1]:
                                await cur.execute(
                                    "SELECT (%s IS NULL OR %s>NOW())",
                                    (row[2], row[2]),
                                )
                                active = bool((await cur.fetchone())[0])
                                if active:
                                    reason = str(row[3] or "Доступ к приложению ограничен.")[:180]
                                    await make_inline_keyboard_inert(event)
                                    try:
                                        await event.answer("Доступ заблокирован: " + reason, show_alert=True)
                                    except Exception:
                                        log.debug("Unable to send ban alert to tg_id=%s", tg_id, exc_info=True)
                                    return None
                                await cur.execute(
                                    "UPDATE users SET is_blocked=0,banned_until=NULL,ban_reason=NULL,ban_details=NULL WHERE tg_id=%s",
                                    (tg_id,),
                                )
                        await conn.commit()
                except Exception:
                    # Let regular handler-level DB handling produce the diagnostic; do not crash polling.
                    log.exception("Could not check ban before callback tg_id=%s", tg_id)
        return await handler(event, data)
