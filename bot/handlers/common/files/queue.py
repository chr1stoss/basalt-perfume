from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *

async def _download_queued_item(bot: Bot, tg_id: int, item: dict):
    if item.get("error"):
        return
    try:
        folder = settings.data_dir / str(tg_id) / "excel"
        folder.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        safe_name = re.sub(r"[^\w.() -]+", "_", Path(item["filename"]).name).strip()[:180] or "price_list" + Path(item["filename"]).suffix.lower()
        destination = folder / f"{stamp}_{secrets.token_hex(2)}_{safe_name}"
        # Retry transient Telegram/proxy failures; partial files are never accepted.
        # Legacy one-shot call was: await bot.get_file(item["file_id"])
        last_error = None
        for attempt in range(1, 4):
            try:
                file_info = await bot.get_file(item["file_id"], request_timeout=60)
                await bot.download_file(file_info.file_path, destination=destination, timeout=120, chunk_size=64 * 1024)
                if not destination.is_file() or destination.stat().st_size <= 0:
                    raise OSError("Telegram returned an empty document")
                last_error = None
                break
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                last_error = exc
                try:
                    destination.unlink(missing_ok=True)
                except OSError:
                    pass
                if attempt < 3:
                    await asyncio.sleep(attempt * 1.5)
        if last_error is not None:
            raise last_error
        item["path"] = destination
        item["size"] = int(item.get("size") or destination.stat().st_size)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        item["error"] = "download_failed"
        item["technical_error"] = str(exc)
        log.exception("Telegram document download failed tg_id=%s filename=%r", tg_id, item.get("filename"))

async def _expire_pending_batch(token: str, delay: float):
    await asyncio.sleep(delay)
    pending = PENDING_BATCHES.pop(token, None)
    if not pending:
        return
    for item in pending.get("files", []):
        path = item.get("path")
        try:
            if path and Path(path).is_file() and Path(path).resolve().is_relative_to(settings.data_dir.resolve()):
                Path(path).unlink()
        except Exception:
            log.exception("Could not clean expired pending upload %r", path)
    log.info("Expired unconfirmed duplicate-upload batch token=%s tg_id=%s", token, pending.get("tg_id"))
