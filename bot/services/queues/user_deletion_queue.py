"""Durable post-deletion cleanup and Telegram notice for users deleted by an admin."""
from __future__ import annotations

import asyncio
import logging
import re
import shutil
from pathlib import Path

from aiogram import Bot
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError, TelegramRetryAfter

from bot.config import settings
from bot.database.connection import pool

log = logging.getLogger(__name__)
QUEUE_DDL = """CREATE TABLE IF NOT EXISTS admin_user_deletion_queue (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tg_id BIGINT UNSIGNED NOT NULL,
    requested_by_tg_id BIGINT UNSIGNED NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at DATETIME NULL,
    sent_at DATETIME NULL,
    last_error VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_admin_user_deletion_status (status, available_at, id),
    KEY idx_admin_user_deletion_tg (tg_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"""


async def ensure_user_deletion_queue_table() -> None:
    """Create the deletion queue table only when missing."""
    async with pool().acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT 1 FROM information_schema.tables "
                "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s LIMIT 1",
                ("admin_user_deletion_queue",),
            )
            if not await cur.fetchone():
                await cur.execute(QUEUE_DDL)
        await conn.commit()

async def _claim_next() -> dict | None:
    async with pool().acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE admin_user_deletion_queue SET status='pending',locked_at=NULL,available_at=NOW() "
                "WHERE status='sending' AND locked_at IS NOT NULL "
                "AND locked_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)"
            )
            await cur.execute(
                "SELECT id,tg_id,attempts FROM admin_user_deletion_queue "
                "WHERE status='pending' AND available_at<=NOW() ORDER BY id LIMIT 1 FOR UPDATE"
            )
            row = await cur.fetchone()
            if not row:
                await conn.commit()
                return None
            job_id, tg_id, attempts = row
            await cur.execute(
                "UPDATE admin_user_deletion_queue SET status='sending',attempts=attempts+1,locked_at=NOW() "
                "WHERE id=%s AND status='pending'", (int(job_id),)
            )
        await conn.commit()
    return {"id": int(job_id), "tg_id": int(tg_id), "attempts": int(attempts or 0) + 1}


async def _update_job(job_id: int, status: str, *, delay: int = 0, error: str | None = None) -> None:
    async with pool().acquire() as conn:
        async with conn.cursor() as cur:
            if status == "sent":
                await cur.execute(
                    "UPDATE admin_user_deletion_queue SET status='sent',sent_at=NOW(),locked_at=NULL,last_error=NULL WHERE id=%s",
                    (job_id,),
                )
            elif status == "failed":
                await cur.execute(
                    "UPDATE admin_user_deletion_queue SET status='failed',locked_at=NULL,last_error=%s WHERE id=%s",
                    ((error or "delivery failed")[:500], job_id),
                )
            else:
                await cur.execute(
                    "UPDATE admin_user_deletion_queue SET status='pending',locked_at=NULL,available_at=DATE_ADD(NOW(), INTERVAL %s SECOND),last_error=%s WHERE id=%s",
                    (max(1, int(delay)), (error or "retry")[:500], job_id),
                )
        await conn.commit()



async def _admin_contact_url() -> str | None:
    """Resolve the configured admin's username; fall back to their Telegram ID link."""
    if not settings.admin_ids:
        return None

    admin_id = int(settings.admin_ids[0])
    try:
        async with pool().acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT username FROM users WHERE tg_id=%s LIMIT 1", (admin_id,))
                row = await cur.fetchone()
        username = str(row[0] or "").strip().lstrip("@") if row else ""
        if username and re.fullmatch(r"[A-Za-z0-9_]{5,32}", username):
            return f"https://t.me/{username}"
    except Exception:
        log.warning("Could not resolve admin username; using Telegram ID link", exc_info=True)

    return f"tg://user?id={admin_id}"


def _deleted_user_notice_keyboard(contact_url: str | None) -> InlineKeyboardMarkup:
    buttons = []
    if contact_url:
        buttons.append(InlineKeyboardButton(text="Написать", url=contact_url))
    buttons.append(InlineKeyboardButton(text="Прочитано", callback_data="dismiss_notice"))
    return InlineKeyboardMarkup(inline_keyboard=[buttons])


def _remove_user_dir(tg_id: int) -> None:
    """Remove only DATA_DIR/<decimal-id>; never follow a symlink out of DATA_DIR."""
    root = Path(settings.data_dir).expanduser().resolve()
    target = root / str(int(tg_id))
    if target.parent != root or target.name != str(int(tg_id)):
        raise ValueError("refusing unsafe user data path")
    try:
        if target.is_symlink():
            target.unlink()
        elif target.exists():
            resolved = target.resolve()
            if resolved.parent != root:
                raise ValueError("user data path resolves outside DATA_DIR")
            shutil.rmtree(target)
    except FileNotFoundError:
        pass


async def process_user_deletion_queue(bot: Bot) -> None:
    while True:
        try:
            await ensure_user_deletion_queue_table()
            break
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("User deletion queue is unavailable; retrying table initialization in 30 seconds")
            await asyncio.sleep(30)

    while True:
        try:
            job = await _claim_next()
            if not job:
                await asyncio.sleep(0.75)
                continue
            try:
                # The account row is already gone; remove its bot-local folder before notifying it.
                _remove_user_dir(job["tg_id"])
                contact_url = await _admin_contact_url()
                await bot.send_message(
                    chat_id=job["tg_id"],
                    text="Ваш аккаунт был удалён администрацией. Данные профиля, прайс-листы и ключи удалены. Если вы считаете это ошибкой, обратитесь к администратору.",
                    reply_markup=_deleted_user_notice_keyboard(contact_url),
                    disable_notification=False,
                )
                await _update_job(job["id"], "sent")
            except asyncio.CancelledError:
                raise
            except (TelegramForbiddenError, TelegramBadRequest) as exc:
                # Bot blocked / user unreachable is terminal; filesystem cleanup has already run.
                await _update_job(job["id"], "failed", error=f"{type(exc).__name__}: {exc}")
                log.warning("Could not notify deleted user %s: %s", job["tg_id"], exc)
            except TelegramRetryAfter as exc:
                delay = int(getattr(exc, "retry_after", 5)) + 1
                if job["attempts"] >= 5:
                    await _update_job(job["id"], "failed", error=f"TelegramRetryAfter: {exc}")
                else:
                    await _update_job(job["id"], "pending", delay=delay, error=f"TelegramRetryAfter: {exc}")
            except Exception as exc:
                if job["attempts"] >= 5:
                    await _update_job(job["id"], "failed", error=f"{type(exc).__name__}: {exc}")
                else:
                    await _update_job(job["id"], "pending", delay=min(300, 2 ** job["attempts"]), error=f"{type(exc).__name__}: {exc}")
                log.exception("Post-deletion task %s failed", job["id"])
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("User deletion worker iteration failed")
            await asyncio.sleep(2)
