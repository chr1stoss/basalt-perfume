#!/usr/bin/env python3
"""One-shot cron worker for website price-list uploads.

The worker imports only the isolated parser package from the account's private
home directory. It never starts a Telegram client and never reads Telegram tokens.
"""
from __future__ import annotations

import argparse
import asyncio
import fcntl
import logging
import os
import sys
import json
import time
from pathlib import Path


def locate_private_worker() -> Path:
    configured = os.getenv("BASALT_WORKER_ROOT", "").strip()
    candidates: list[Path] = []
    if configured:
        candidates.append(Path(configured).expanduser())
    candidates.append(Path.home() / "private" / "basalt-site-worker")
    script = Path(__file__).resolve()
    candidates.extend(parent / "private" / "basalt-site-worker" for parent in script.parents)
    seen: set[str] = set()
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        marker = str(resolved)
        if marker in seen:
            continue
        seen.add(marker)
        if (resolved / "config.py").is_file() and (resolved / "services" / "parser" / "price_list.py").is_file():
            return resolved
    raise SystemExit(
        "Не найден приватный пакет: ожидается $HOME/private/basalt-site-worker. "
        "Проверьте размещение UPLOAD_TO_HOME и переменную BASALT_WORKER_ROOT."
    )


WORKER_ROOT = locate_private_worker()
sys.path.insert(0, str(WORKER_ROOT))
os.chdir(WORKER_ROOT)

from config import settings  # noqa: E402

# The private config.py used on Sweb does not have to export WORKER_ROOT.
# The worker root has already been resolved safely by locate_private_worker().
CONFIG_ROOT = WORKER_ROOT
from database.connection import close_db, init_db, pool  # noqa: E402
from services.parser.price_list import process_web_uploaded_price_file  # noqa: E402
from services.duplicate_detection import scan_upload_batch  # noqa: E402

logging.basicConfig(
    level=getattr(logging, settings.log_level, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("basalt.website_upload_worker")

LOCK_FILE = CONFIG_ROOT / ".web-upload-worker.lock"
HEARTBEAT_SECONDS = 30
STALE_AFTER_MINUTES = 3
MAX_ATTEMPTS = 3

MAX_STAGING_SCAN_BATCHES = 5
STAGING_DIR_NAME = ".web-upload-staging"


def _atomic_json_write(path: Path, payload: dict) -> None:
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(temp, path)


async def process_pending_upload_scans() -> int:
    """Scan staged upload batches requested by the WebApp; no catalogue writes."""
    root = settings.upload_storage_dir.resolve()
    if not root.is_dir():
        return 0
    processed = 0
    for user_dir in sorted(root.iterdir()):
        if processed >= MAX_STAGING_SCAN_BATCHES:
            break
        if not user_dir.is_dir() or not user_dir.name.isdigit():
            continue
        user_real = user_dir.resolve()
        if not user_real.is_relative_to(root):
            continue
        staging_root = user_real / STAGING_DIR_NAME
        if not staging_root.is_dir():
            continue
        for batch_dir in sorted(staging_root.iterdir()):
            if processed >= MAX_STAGING_SCAN_BATCHES:
                break
            manifest_path = batch_dir / "manifest.json"
            try:
                batch_real = batch_dir.resolve(strict=True)
                if not batch_real.is_dir() or not batch_real.is_relative_to(user_real):
                    continue
                manifest_path = batch_real / "manifest.json"
                if not manifest_path.is_file():
                    continue
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                if int(manifest.get("owner_tg_id") or 0) != int(user_dir.name):
                    raise RuntimeError("Staged upload manifest owner mismatch")
                created_at = float(manifest.get("created_at") or time.time())
                if time.time() - created_at > 86400:
                    import shutil
                    shutil.rmtree(batch_real, ignore_errors=True)
                    log.info("Expired staged upload batch removed: %s", batch_dir.name)
                    continue
                state = str(manifest.get("status") or "")
                if state == "scanning":
                    started = float(manifest.get("scan_started_at") or 0)
                    if started and time.time() - started > 600:
                        manifest["status"] = "scan_pending"
                        state = "scan_pending"
                    else:
                        continue
                if state != "scan_pending":
                    continue
                manifest["status"] = "scanning"
                manifest["scan_progress"] = 0.0
                manifest["scan_started_at"] = time.time()
                _atomic_json_write(manifest_path, manifest)
                last_progress_write = {"value": -1.0, "at": 0.0}

                def persist_scan_progress(value: float) -> None:
                    progress_value = max(0.0, min(100.0, float(value)))
                    now = time.monotonic()
                    if progress_value < 100 and progress_value - last_progress_write["value"] < 0.5 and now - last_progress_write["at"] < 0.4:
                        return
                    try:
                        current = json.loads(manifest_path.read_text(encoding="utf-8"))
                        if current.get("status") != "scanning":
                            return
                        current["scan_progress"] = round(max(float(current.get("scan_progress") or 0), progress_value), 1)
                        _atomic_json_write(manifest_path, current)
                        last_progress_write["value"] = progress_value
                        last_progress_write["at"] = now
                    except Exception:
                        log.debug("Could not persist scan progress for %s", batch_dir.name, exc_info=True)

                result = await scan_upload_batch(int(user_dir.name), manifest, progress=persist_scan_progress)
                manifest["review"] = result.get("files", [])
                manifest["scan_progress"] = 100.0
                manifest["status"] = "review_ready"
                manifest["scan_error"] = None
                manifest["scan_started_at"] = None
                _atomic_json_write(manifest_path, manifest)
                processed += 1
                log.info("Upload conflict scan completed for user=%s batch=%s files=%s conflicts=%s",
                         user_dir.name, batch_dir.name, len(manifest.get("files", [])),
                         sum(1 for item in manifest["review"] if item.get("conflict")))
            except Exception as exc:
                log.exception("Upload conflict scan failed for user=%s batch=%s", user_dir.name, batch_dir.name)
                try:
                    if manifest_path.is_file():
                        failed = json.loads(manifest_path.read_text(encoding="utf-8"))
                        failed["status"] = "scan_error"
                        failed["scan_progress"] = float(failed.get("scan_progress") or 0)
                        failed["scan_error"] = "Не удалось проверить файлы. Повторите проверку или отмените загрузку."
                        failed["scan_started_at"] = None
                        _atomic_json_write(manifest_path, failed)
                except Exception:
                    log.exception("Could not persist conflict scan error for %s", batch_dir)
                processed += 1
    return processed


async def apply_replacement_metadata(job: dict) -> bool:
    """Commit old-file removal only after the replacement parser succeeded."""
    sidecar = Path(str(job["filepath"]) + ".replace.json")
    if not sidecar.is_file():
        return False
    try:
        metadata = json.loads(sidecar.read_text(encoding="utf-8"))
        owner_id = int(metadata.get("owner_tg_id", 0))
        new_id = int(metadata.get("price_list_id", 0))
        if owner_id != int(job["owner_tg_id"]) or new_id != int(job["price_list_id"]):
            raise RuntimeError("Replacement metadata ownership mismatch")
        target_name = Path(str(metadata.get("final_filename") or job["filename"])).name[:230]
        old_ids = sorted({int(value) for value in metadata.get("existing_ids", []) if int(value) > 0 and int(value) != new_id})
        old_paths = {str(value) for value in metadata.get("existing_paths", []) if isinstance(value, str) and value}
        removed_paths: set[Path] = set()
        root = settings.upload_storage_dir.resolve()
        waiting_for_old = False
        async with pool().acquire() as conn:
            await conn.begin()
            try:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "SELECT id,filename,filepath,status FROM price_lists WHERE id=%s AND owner_tg_id=%s FOR UPDATE",
                        (new_id, owner_id),
                    )
                    new_row = await cur.fetchone()
                    if not new_row:
                        raise RuntimeError("New replacement record is missing")
                    old_rows_by_id = {}
                    if old_ids:
                        placeholders = ",".join(["%s"] * len(old_ids))
                        await cur.execute(
                            "SELECT id,filepath,status FROM price_lists WHERE owner_tg_id=%s AND id IN (" + placeholders + ") FOR UPDATE",
                            tuple([owner_id] + old_ids),
                        )
                        for row in await cur.fetchall():
                            old_rows_by_id[int(row[0])] = row
                    # Catch an exact-name conflict added after the browser scan. The
                    # selected Replace decision also applies to that newly visible row.
                    await cur.execute(
                        "SELECT id,filepath,status FROM price_lists WHERE owner_tg_id=%s AND filename=%s AND id<>%s FOR UPDATE",
                        (owner_id, target_name, new_id),
                    )
                    for row in await cur.fetchall():
                        old_rows_by_id[int(row[0])] = row
                    old_rows = list(old_rows_by_id.values())
                    if any(str(row[2]).lower() == "processing" for row in old_rows):
                        waiting_for_old = True
                        raise RuntimeError("Ожидается завершение обработки предыдущей версии файла")
                    actual_ids = [int(row[0]) for row in old_rows]
                    for _old_id, old_path, _old_status in old_rows:
                        if old_path:
                            try:
                                resolved = Path(str(old_path)).resolve()
                                if resolved.is_file() and resolved.is_relative_to(root):
                                    removed_paths.add(resolved)
                            except (OSError, ValueError):
                                log.warning("Ignored unsafe old replacement path %r", old_path)
                    if actual_ids:
                        placeholders = ",".join(["%s"] * len(actual_ids))
                        # user_favorites has no FK to products: remove favorites for
                        # the old catalogue rows before the price-list cascade deletes them.
                        await cur.execute(
                            "DELETE f FROM user_favorites f "
                            "INNER JOIN products p ON p.id=f.product_id "
                            "INNER JOIN source_rows sr ON sr.id=p.source_row_id "
                            "WHERE sr.price_list_id IN (" + placeholders + ")",
                            tuple(actual_ids),
                        )
                        await cur.execute(
                            "DELETE FROM price_lists WHERE owner_tg_id=%s AND id IN (" + placeholders + ")",
                            tuple([owner_id] + actual_ids),
                        )
                    for raw_path in old_paths:
                        try:
                            resolved = Path(raw_path).resolve()
                            if resolved.is_file() and resolved.is_relative_to(root):
                                removed_paths.add(resolved)
                        except (OSError, ValueError):
                            log.warning("Ignored unsafe orphan replacement path %r", raw_path)
                    await cur.execute(
                        "UPDATE price_lists SET filename=%s,status='ready' WHERE id=%s AND owner_tg_id=%s",
                        (target_name, new_id, owner_id),
                    )
                await conn.commit()
            except Exception:
                await conn.rollback()
                if waiting_for_old:
                    async with pool().acquire() as state_conn:
                        async with state_conn.cursor() as state_cur:
                            await state_cur.execute(
                                "UPDATE price_lists SET status='processing' WHERE id=%s AND owner_tg_id=%s",
                                (new_id, owner_id),
                            )
                        await state_conn.commit()
                raise
        # Never unlink a path that is still referenced by another catalogue row.
        for old_path in removed_paths:
            try:
                async with pool().acquire() as conn:
                    async with conn.cursor() as cur:
                        await cur.execute("SELECT 1 FROM price_lists WHERE filepath=%s LIMIT 1", (str(old_path),))
                        still_used = await cur.fetchone()
                if not still_used and old_path.is_file() and old_path.resolve().is_relative_to(root):
                    old_path.unlink()
            except Exception:
                log.exception("Could not remove replaced old file %s", old_path)
        sidecar.unlink(missing_ok=True)
        log.info("Committed replacement for user=%s new_price_list=%s old_ids=%s", owner_id, new_id, old_ids)
        return True
    except Exception:
        log.exception("Could not commit successful replacement for job=%s", job.get("id"))
        raise


async def recover_ready_replacements() -> None:
    """Finish replacement sidecars if a worker stopped after parser commit."""
    async with pool().acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT j.id,j.price_list_id,j.owner_tg_id,j.filename,j.filepath,j.size_bytes "
                "FROM web_upload_site_jobs j "
                "WHERE j.status='processing'"
            )
            rows = await cur.fetchall()
    for row in rows:
        job = {"id": int(row[0]), "price_list_id": int(row[1]), "owner_tg_id": int(row[2]),
               "filename": str(row[3]), "filepath": str(row[4]), "size_bytes": int(row[5] or 0)}
        if Path(job["filepath"] + ".replace.json").is_file():
            try:
                await apply_replacement_metadata(job)
            except Exception:
                # Keep the sidecar/job processing so the next Cron tick can retry.
                # recover_stale_jobs explicitly excludes jobs that still have sidecars.
                log.warning("Replacement for job=%s is deferred; old data remains intact", job["id"])



def localized_notification(language: str, filename: str, stats: dict | None, ok: bool) -> tuple[str, str]:
    lang = (language or "ru").strip().lower().replace("_", "-").split("-", 1)[0]
    if lang in ("kk", "kz"):
        lang = "kz"
    if lang not in ("ru", "en", "kz"):
        lang = "ru"
    if ok:
        stats = stats or {}
        if lang == "en":
            return "Price list processed", (
                f"File: {filename}\nProduct rows: {stats.get('products', 0)}\n"
                f"Sets: {stats.get('sets', 0)} · components: {stats.get('components', 0)}\n"
                f"Needs review: {stats.get('review', 0)}"
            )
        if lang == "kz":
            return "Прайс-парақ өңделді", (
                f"Файл: {filename}\nТауар жолдары: {stats.get('products', 0)}\n"
                f"Жиынтықтар: {stats.get('sets', 0)} · компоненттер: {stats.get('components', 0)}\n"
                f"Тексеру қажет: {stats.get('review', 0)}"
            )
        return "Прайс-лист обработан", (
            f"Файл: {filename}\nТоварных строк: {stats.get('products', 0)}\n"
            f"Наборов: {stats.get('sets', 0)} · компонентов: {stats.get('components', 0)}\n"
            f"На проверку: {stats.get('review', 0)}"
        )
    if lang == "en":
        return "Price list processing failed", (
            f"File: {filename}\nThe file could not be processed. Check the file format and try uploading it again."
        )
    if lang == "kz":
        return "Прайс-парақты өңдеу сәтсіз аяқталды", (
            f"Файл: {filename}\nФайл өңделмеді. Форматын тексеріп, қайта жүктеп көріңіз."
        )
    return "Не удалось обработать прайс-лист", (
        f"Файл: {filename}\nНе удалось обработать файл. Проверьте формат и попробуйте загрузить его ещё раз."
    )


async def save_app_notification(tg_id: int, filename: str, stats: dict | None, ok: bool) -> None:
    """Persist the same in-app notification as the local application; no Telegram call."""
    try:
        async with pool().acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT COALESCE(notify_processed_files,1),COALESCE(language,'ru') "
                    "FROM user_settings WHERE tg_id=%s",
                    (int(tg_id),),
                )
                row = await cur.fetchone()
                if row and not int(row[0]):
                    return
                language = str(row[1] if row else "ru")
                title, body = localized_notification(language, filename, stats, ok)
                await cur.execute(
                    "INSERT INTO app_notifications(tg_id,kind,title,body) VALUES(%s,%s,%s,%s)",
                    (int(tg_id), "file_processed", title[:190], body),
                )
            await conn.commit()
    except Exception:
        log.exception("Could not persist in-app processing notification for user %s", tg_id)


async def recover_stale_jobs(cur) -> None:
    """Reconcile committed parser results, then recover interrupted jobs."""
    # A parsed replacement may be waiting for an older bot upload to finish. Keep
    # that job locked in the logical queue until its sidecar can be committed.
    await cur.execute("SELECT id,filepath FROM web_upload_site_jobs WHERE status='processing'")
    active_rows = await cur.fetchall()
    waiting_replacements = [int(row[0]) for row in active_rows if Path(str(row[1]) + ".replace.json").is_file()]
    exclusion = ""
    exclusion_params: tuple = ()
    if waiting_replacements:
        placeholders = ",".join(["%s"] * len(waiting_replacements))
        exclusion = " AND j.id NOT IN (" + placeholders + ")"
        exclusion_params = tuple(waiting_replacements)

    # The parser transaction marks price_lists=ready only after all product rows commit.
    # If a process exits between that commit and queue finalization, never parse twice.
    await cur.execute(
        "UPDATE web_upload_site_jobs j JOIN price_lists pl ON pl.id=j.price_list_id "
        "SET j.status='done',j.locked_at=NULL,j.last_error=NULL,j.updated_at=NOW() "
        "WHERE j.status='processing' AND pl.status='ready'" + exclusion,
        exclusion_params,
    )
    await cur.execute(
        "UPDATE web_upload_site_jobs j JOIN price_lists pl ON pl.id=j.price_list_id "
        "SET j.status='error',j.locked_at=NULL,j.last_error=COALESCE(j.last_error,'Parser already marked this file as failed'),j.updated_at=NOW() "
        "WHERE j.status='processing' AND pl.status='error'" + exclusion,
        exclusion_params,
    )
    await cur.execute(
        "UPDATE price_lists pl JOIN web_upload_site_jobs j ON j.price_list_id=pl.id "
        "SET pl.status='error' "
        "WHERE j.status='processing' AND j.attempts >= %s "
        "AND (j.locked_at IS NULL OR j.locked_at < DATE_SUB(NOW(), INTERVAL %s MINUTE)) "
        "AND pl.status='processing'" + exclusion,
        (MAX_ATTEMPTS, STALE_AFTER_MINUTES) + exclusion_params,
    )
    await cur.execute(
        "UPDATE web_upload_site_jobs j SET j.status='error',j.locked_at=NULL,"
        "j.last_error='Worker stopped unexpectedly after three attempts',j.updated_at=NOW() "
        "WHERE j.status='processing' AND j.attempts >= %s "
        "AND (j.locked_at IS NULL OR j.locked_at < DATE_SUB(NOW(), INTERVAL %s MINUTE))" + exclusion.replace("j.id", "j.id"),
        (MAX_ATTEMPTS, STALE_AFTER_MINUTES) + exclusion_params,
    )
    await cur.execute(
        "UPDATE web_upload_site_jobs j SET j.status='pending',j.locked_at=NULL,"
        "j.last_error='Recovered stale worker lock',j.updated_at=NOW() "
        "WHERE j.status='processing' AND j.attempts < %s "
        "AND (j.locked_at IS NULL OR j.locked_at < DATE_SUB(NOW(), INTERVAL %s MINUTE))" + exclusion.replace("j.id", "j.id"),
        (MAX_ATTEMPTS, STALE_AFTER_MINUTES) + exclusion_params,
    )


async def claim_next() -> dict | None:
    async with pool().acquire() as conn:
        await conn.begin()
        try:
            async with conn.cursor() as cur:
                await recover_stale_jobs(cur)
                await cur.execute(
                    "SELECT id,price_list_id,owner_tg_id,filename,filepath,size_bytes "
                    "FROM web_upload_site_jobs WHERE status='pending' "
                    "ORDER BY id LIMIT 1 FOR UPDATE"
                )
                row = await cur.fetchone()
                if not row:
                    await conn.commit()
                    return None
                job_id, price_list_id, owner_tg_id, filename, filepath, size_bytes = row
                await cur.execute(
                    "UPDATE web_upload_site_jobs SET status='processing',attempts=attempts+1,"
                    "locked_at=NOW(),last_error=NULL,updated_at=NOW() "
                    "WHERE id=%s AND status='pending'",
                    (int(job_id),),
                )
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise
    return {
        "id": int(job_id),
        "price_list_id": int(price_list_id),
        "owner_tg_id": int(owner_tg_id),
        "filename": str(filename),
        "filepath": str(filepath),
        "size_bytes": int(size_bytes or 0),
    }


async def update_heartbeat(job_id: int, stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            async with pool().acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "UPDATE web_upload_site_jobs SET locked_at=NOW(),updated_at=NOW() "
                        "WHERE id=%s AND status='processing'",
                        (int(job_id),),
                    )
                await conn.commit()
        except Exception:
            log.exception("Heartbeat update failed for queue job %s", job_id)
        try:
            await asyncio.wait_for(stop.wait(), timeout=HEARTBEAT_SECONDS)
        except asyncio.TimeoutError:
            pass


async def finish_job(job: dict, ok: bool, error: str | None = None) -> None:
    async with pool().acquire() as conn:
        await conn.begin()
        try:
            async with conn.cursor() as cur:
                await cur.execute(
                    "UPDATE web_upload_site_jobs SET status=%s,locked_at=NULL,last_error=%s,updated_at=NOW() "
                    "WHERE id=%s",
                    ("done" if ok else "error", (error or "")[:1000] or None, job["id"]),
                )
                await cur.execute(
                    "UPDATE price_lists SET status=%s WHERE id=%s",
                    ("ready" if ok else "error", job["price_list_id"]),
                )
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise


def validate_upload_path(raw_path: str) -> Path:
    storage_root = settings.upload_storage_dir.resolve()
    candidate = Path(raw_path).resolve(strict=True)
    try:
        candidate.relative_to(storage_root)
    except ValueError as exc:
        raise RuntimeError("Путь файла в БД находится вне приватного каталога uploaded_filed") from exc
    if not candidate.is_file():
        raise FileNotFoundError("Загруженный файл не найден на диске")
    return candidate


async def process_job(job: dict) -> bool:
    log.info("Processing website queue job %s: %s (%s bytes)", job["id"], job["filename"], job["size_bytes"])
    stop = asyncio.Event()
    heartbeat_task = asyncio.create_task(update_heartbeat(job["id"], stop))
    ok = False
    parsed_ok = False
    stats = None
    error_text = None
    try:
        if job["size_bytes"] > settings.max_file_size_mb * 1024 * 1024:
            raise RuntimeError(f"Размер файла превышает лимит {settings.max_file_size_mb} МБ")
        safe_path = validate_upload_path(job["filepath"])
        result = await process_web_uploaded_price_file(
            job["owner_tg_id"], job["filename"], safe_path, job["size_bytes"], job["price_list_id"]
        )
        ok = bool(result.get("ok"))
        parsed_ok = ok
        stats = result.get("stats") if ok else None
        if not ok:
            error_text = str(result.get("technical_error") or "Парсер не смог обработать файл")
        else:
            await apply_replacement_metadata(job)
        await finish_job(job, ok, error_text)
        if not ok:
            Path(str(job["filepath"]) + ".replace.json").unlink(missing_ok=True)
        await save_app_notification(job["owner_tg_id"], job["filename"], stats, ok)
        log.info("Queue job %s finished with status %s", job["id"], "done" if ok else "error")
        return ok
    except Exception as exc:
        error_text = f"{type(exc).__name__}: {exc}"
        log.exception("Queue job %s failed", job["id"])
        if parsed_ok:
            # Keep the job in processing with its sidecar intact. The next Cron tick
            # retries the idempotent replacement transaction before stale-job recovery.
            return False
        try:
            await finish_job(job, False, error_text)
            Path(str(job["filepath"]) + ".replace.json").unlink(missing_ok=True)
        except Exception:
            log.exception("Could not update failed queue job %s", job["id"])
        await save_app_notification(job["owner_tg_id"], job["filename"], None, False)
        return False
    finally:
        stop.set()
        await heartbeat_task


async def preflight() -> int:
    import openpyxl  # noqa: F401
    import xlrd  # noqa: F401
    if not settings.upload_storage_dir.is_dir():
        raise RuntimeError(f"Не найден каталог хранения файлов: {settings.upload_storage_dir}")
    if not os.access(settings.upload_storage_dir, os.R_OK | os.X_OK):
        raise RuntimeError(f"Нет прав чтения каталога: {settings.upload_storage_dir}")
    await init_db()
    try:
        async with pool().acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT 1")
                await cur.fetchone()
        log.info("Preflight OK: Python dependencies, private parser, storage directory and MySQL schema are available")
    finally:
        await close_db()
    return 0


async def run_once() -> int:
    await init_db()
    try:
        scans = await process_pending_upload_scans()
        await recover_ready_replacements()
        if scans:
            log.info("Processed %s staged upload conflict scan(s)", scans)
        job = await claim_next()
        if job is None:
            if not scans:
                log.info("No pending website uploads.")
            return 0
        return 0 if await process_job(job) else 2
    finally:
        await close_db()


def main() -> int:
    parser = argparse.ArgumentParser(description="Basalt Perfume website price-list worker")
    parser.add_argument("--check", action="store_true", help="verify config, storage and MySQL without claiming jobs")
    args = parser.parse_args()

    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOCK_FILE.open("a+") as lock_handle:
        try:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log.info("Another worker process is active; this cron tick is skipped.")
            return 0
        return asyncio.run(preflight() if args.check else run_once())


if __name__ == "__main__":
    raise SystemExit(main())
