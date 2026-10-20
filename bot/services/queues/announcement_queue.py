"""Durable asynchronous delivery for WebApp announcement notifications."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError, TelegramRetryAfter
from aiogram.types import FSInputFile, InlineKeyboardButton, InlineKeyboardMarkup

from bot.database.connection import pool
from bot.services.notifications import escape_html, schedule_message_cleanup

log = logging.getLogger(__name__)
LOGO_ASSET = Path(__file__).resolve().parents[2] / "assets" / "none" / "logo.jpg"
QUEUE_DDL = """CREATE TABLE IF NOT EXISTS telegram_notification_queue (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    notification_id BIGINT NOT NULL,
    chat_id BIGINT NOT NULL,
    title VARCHAR(190) NOT NULL,
    body TEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at DATETIME NULL,
    sent_at DATETIME NULL,
    last_error VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tg_notification_chat (notification_id, chat_id),
    KEY idx_tg_notification_queue_status (status, available_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"""


async def ensure_announcement_queue_table() -> None:
    """Create the queue table only when it is missing, avoiding benign MySQL warnings."""
    async with pool().acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT 1 FROM information_schema.tables "
                "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s LIMIT 1",
                ("telegram_notification_queue",),
            )
            if not await cur.fetchone():
                await cur.execute(QUEUE_DDL)
        await conn.commit()

async def _claim_next() -> dict | None:
    async with pool().acquire() as conn:
        async with conn.cursor() as cur:
            # Recover jobs abandoned by a bot process that exited mid-send.
            await cur.execute(
                "UPDATE telegram_notification_queue SET status='pending',locked_at=NULL,available_at=NOW() "
                "WHERE status='sending' AND locked_at IS NOT NULL AND locked_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)"
            )
            await cur.execute(
                "SELECT id,notification_id,chat_id,title,body,attempts "
                "FROM telegram_notification_queue WHERE status='pending' AND available_at<=NOW() "
                "ORDER BY id LIMIT 1 FOR UPDATE"
            )
            row = await cur.fetchone()
            if not row:
                await conn.commit()
                return None
            queue_id, notification_id, chat_id, title, body, attempts = row
            await cur.execute(
                "UPDATE telegram_notification_queue SET status='sending',attempts=attempts+1,locked_at=NOW() "
                "WHERE id=%s AND status='pending'",
                (int(queue_id),),
            )
        await conn.commit()
    return {
        "id": int(queue_id), "notification_id": int(notification_id), "chat_id": int(chat_id),
        "title": str(title or "Обновление")[:190], "body": str(body or "")[:4000], "attempts": int(attempts or 0) + 1,
    }


async def _mark_sent(queue_id: int) -> None:
    async with pool().acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE telegram_notification_queue SET status='sent',sent_at=NOW(),locked_at=NULL,last_error=NULL WHERE id=%s",
                (queue_id,),
            )
        await conn.commit()


async def _mark_failed_or_retry(job: dict, exc: Exception, delay: int | None = None) -> None:
    attempts = int(job["attempts"])
    retry = attempts < 5
    if delay is None:
        delay = min(300, 2 ** attempts)
    status = "pending" if retry else "failed"
    error = (type(exc).__name__ + ": " + str(exc)).replace("\x00", "")[:490]
    async with pool().acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE telegram_notification_queue SET status=%s,locked_at=NULL,available_at=DATE_ADD(NOW(), INTERVAL %s SECOND),last_error=%s WHERE id=%s",
                (status, max(1, int(delay)), error, int(job["id"])),
            )
        await conn.commit()
    if retry:
        log.warning("Announcement queue job %s failed, retry %s/5 in %ss: %s", job["id"], attempts, delay, error)
    else:
        log.error("Announcement queue job %s marked failed after %s attempts: %s", job["id"], attempts, error)


async def process_announcement_queue(bot: Bot) -> None:
    """Send one queued notification at a time and keep HTTP publish requests fast."""
    while True:
        try:
            await ensure_announcement_queue_table()
            break
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Announcement queue table unavailable; retrying initialization in 30 seconds")
            await asyncio.sleep(30)

    while True:
        try:
            job = await _claim_next()
            if job is None:
                await asyncio.sleep(0.75)
                continue
            try:
                keyboard = InlineKeyboardMarkup(inline_keyboard=[[
                    InlineKeyboardButton(text="Прочитано", callback_data="read:" + str(job["notification_id"]))
                ]])
                asset = LOGO_ASSET
                if not asset.is_file():
                    raise FileNotFoundError("assets/none/logo.jpg is missing")
                sent = await bot.send_photo(
                    chat_id=job["chat_id"],
                    photo=FSInputFile(str(asset)),
                    caption="<b>" + escape_html(job["title"]) + "</b>\n\n" + escape_html(job["body"][:800]),
                    reply_markup=keyboard,
                    parse_mode="HTML",
                )
                await schedule_message_cleanup(job["chat_id"], sent.message_id, job["notification_id"])
                await _mark_sent(job["id"])
                # Stay below Telegram broadcast limits on busy announcements.
                await asyncio.sleep(0.06)
            except asyncio.CancelledError:
                raise
            except TelegramRetryAfter as exc:
                await _mark_failed_or_retry(job, exc, int(getattr(exc, "retry_after", 5)) + 1)
            except (TelegramForbiddenError, TelegramBadRequest) as exc:
                # User has blocked the bot / deleted the message target; repeated attempts won't help.
                await _mark_failed_or_retry(dict(job, attempts=5), exc, 300)
            except Exception as exc:
                await _mark_failed_or_retry(job, exc)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Announcement queue worker iteration failed")
            await asyncio.sleep(2)
