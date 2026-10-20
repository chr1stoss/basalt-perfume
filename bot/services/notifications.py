import asyncio
import logging
from pathlib import Path

from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest
from aiogram.types import FSInputFile, InlineKeyboardButton, InlineKeyboardMarkup

from bot.config import settings
from bot.core.i18n import normalize_language, tr
from bot.database.connection import pool

log = logging.getLogger(__name__)
ASSET = Path(__file__).resolve().parents[1] / "assets" / "ru" / "main.jpg"
CLEANUP_INTERVAL_SECONDS = 12
MAX_DELETE_ATTEMPTS = 2


async def save_notification(tg_id: int, kind: str, title: str, body: str) -> int:
    async with pool().acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO app_notifications(tg_id,kind,title,body) VALUES(%s,%s,%s,%s)",
                (tg_id, kind, title[:190], body),
            )
            notification_id = cur.lastrowid
        await conn.commit()
    return int(notification_id)


async def schedule_message_cleanup(chat_id: int, message_id: int, notification_id: int):
    async with pool().acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT IGNORE INTO telegram_message_cleanup(chat_id,message_id,notification_id,delete_after) "
                "VALUES(%s,%s,%s,DATE_ADD(NOW(),INTERVAL 1 MINUTE))",
                (int(chat_id), int(message_id), int(notification_id)),
            )
        await conn.commit()


def _is_permanent_delete_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(marker in text for marker in (
        "message to delete not found",
        "message_id_invalid",
        "message identifier is not specified",
        "message can't be deleted",
        "message can\'t be deleted",
        "too late",
        "message is not modified",
    ))


async def cleanup_expired_telegram_messages(bot: Bot):
    """Delete expired Telegram messages without retrying known-terminal failures forever.

    Unexpected failures get at most two attempts during this process lifetime. If the
    target message already disappeared or Telegram says it can no longer be deleted,
    the queue row is removed immediately. This prevents a broken ID from continually
    consuming DB and Telegram API requests.
    """
    failures: dict[int, int] = {}
    while True:
        try:
            async with pool().acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "SELECT c.id,c.chat_id,c.message_id,c.notification_id,COALESCE(n.is_read,0) "
                        "FROM telegram_message_cleanup c LEFT JOIN app_notifications n ON n.id=c.notification_id "
                        "WHERE c.delete_after<=NOW() ORDER BY c.id LIMIT 100"
                    )
                    rows = await cur.fetchall()
            delete_ids: list[int] = []
            for row_id, chat_id, message_id, _notification_id, is_read in rows:
                row_id = int(row_id)
                if int(is_read):
                    delete_ids.append(row_id)
                    failures.pop(row_id, None)
                    continue
                try:
                    await bot.delete_message(chat_id=int(chat_id), message_id=int(message_id))
                    delete_ids.append(row_id)
                    failures.pop(row_id, None)
                except asyncio.CancelledError:
                    raise
                except TelegramBadRequest as exc:
                    if _is_permanent_delete_error(exc):
                        log.debug(
                            "Cleanup entry %s is terminal (message already gone/too old), dropping it: %s",
                            row_id, exc,
                        )
                        delete_ids.append(row_id)
                        failures.pop(row_id, None)
                    else:
                        failures[row_id] = failures.get(row_id, 0) + 1
                        log.warning("Telegram cleanup failed (%s/%s) for row %s: %s", failures[row_id], MAX_DELETE_ATTEMPTS, row_id, exc)
                        if failures[row_id] >= MAX_DELETE_ATTEMPTS:
                            log.error("Abandoning Telegram cleanup row %s after %s consecutive failures", row_id, failures[row_id])
                            delete_ids.append(row_id)
                            failures.pop(row_id, None)
                except Exception:
                    failures[row_id] = failures.get(row_id, 0) + 1
                    log.exception("Unexpected Telegram cleanup failure (%s/%s) for row %s", failures[row_id], MAX_DELETE_ATTEMPTS, row_id)
                    if failures[row_id] >= MAX_DELETE_ATTEMPTS:
                        log.error("Abandoning Telegram cleanup row %s after %s consecutive failures", row_id, failures[row_id])
                        delete_ids.append(row_id)
                        failures.pop(row_id, None)
            if delete_ids:
                async with pool().acquire() as conn:
                    async with conn.cursor() as cur:
                        placeholders = ",".join(["%s"] * len(delete_ids))
                        await cur.execute(
                            "DELETE FROM telegram_message_cleanup WHERE id IN (" + placeholders + ")",
                            tuple(delete_ids),
                        )
                    await conn.commit()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Telegram notification cleanup loop failed")
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)


async def notify_user(bot: Bot, tg_id: int, kind: str, title: str, body: str):
    """Persist an app notification and optionally mirror it to Telegram.

    A Telegram send/cleanup failure must not undo the WebApp notification, but every
    unexpected failure is logged with its context rather than silently swallowed.
    """
    preference = {"update": "notify_updates", "file_processed": "notify_processed_files", "subscription": "notify_subscription"}.get(kind)
    language = "ru"
    notification_id = None
    try:
        async with pool().acquire() as conn:
            async with conn.cursor() as cur:
                if preference:
                    # Preference names are selected only from the fixed allow-list above.
                    await cur.execute(
                        "SELECT COALESCE(" + preference + ",1),COALESCE(language,'ru') FROM user_settings WHERE tg_id=%s",
                        (tg_id,),
                    )
                    row = await cur.fetchone()
                    if row and not int(row[0]):
                        return None
                    if row:
                        language = normalize_language(row[1])
                else:
                    await cur.execute("SELECT COALESCE(language,'ru') FROM user_settings WHERE tg_id=%s", (tg_id,))
                    row = await cur.fetchone()
                    if row:
                        language = normalize_language(row[0])
        notification_id = await save_notification(tg_id, kind, title, body)
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("Could not persist/read notification data tg_id=%s kind=%s", tg_id, kind)
        return None

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=tr(language, "read"), callback_data="read:" + str(notification_id))]
    ])
    try:
        asset = ASSET if ASSET.is_file() else (Path(__file__).resolve().parents[1] / "assets" / "none" / "logo.jpg")
        sent = await bot.send_photo(
            chat_id=tg_id,
            photo=FSInputFile(str(asset)),
            caption="<b>" + escape_html(title) + "</b>\n\n" + escape_html(str(body or "")[:850]),
            reply_markup=keyboard,
            parse_mode="HTML",
        )
        await schedule_message_cleanup(tg_id, sent.message_id, notification_id)
    except asyncio.CancelledError:
        raise
    except Exception:
        # Keep notification in the WebApp even if Telegram is unavailable.
        log.exception("Could not mirror WebApp notification to Telegram tg_id=%s kind=%s id=%s", tg_id, kind, notification_id)
    return notification_id


def escape_html(text: str) -> str:
    return str(text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
