from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *
from bot.handlers.common.files.conflict_scan import get_existing_filename_conflicts
from bot.handlers.common.files.queue import _expire_pending_batch
from bot.handlers.common.files.replace_named import replace_existing_named_files
from bot.handlers.common.keyboards.replace_item import replacement_item_keyboard
from bot.handlers.common.keyboards.replacement import replacement_keyboard
from bot.handlers.common.messages.language import get_language_or_default
from bot.services.file_names import normalize_filename, filename_similarity


def _resolve_conflict_key(filename: str, conflicts: dict[str, dict]) -> str | None:
    """Associate an incoming filename with a detected conflict key defensively.

    Normally conflict_scan uses the incoming normalized name as the key. The
    fallbacks cover older deployments that keyed conflicts by the stored name.
    """
    norm = normalize_filename(filename)
    if norm in conflicts:
        return norm
    normalized_keys = [key for key in conflicts if normalize_filename(key) == norm]
    if len(normalized_keys) == 1:
        return normalized_keys[0]
    # Older scanners sometimes keep the old/stored name as the display name/key.
    scored = []
    for key, details in conflicts.items():
        existing_name = str((details or {}).get("name") or key)
        score = filename_similarity(filename, existing_name)
        if score >= 0.93:
            scored.append((score, key))
    scored.sort(reverse=True)
    if scored and (len(scored) == 1 or scored[0][0] > scored[1][0] + 0.01):
        return scored[0][1]
    return None


def _build_conflict_items(files: list[dict], conflicts: dict[str, dict]) -> list[dict]:
    """Build one selectable item per conflicting incoming file."""
    result = []
    unmatched = []
    for index, item in enumerate(files):
        if not item.get("path"):
            continue
        filename = Path(str(item.get("filename") or item["path"])).name
        conflict_key = _resolve_conflict_key(filename, conflicts)
        if conflict_key is None:
            unmatched.append((index, item, filename))
            continue
        result.append({
            "index": index,
            "norm": normalize_filename(filename),
            "conflict_norm": conflict_key,
            "filename": filename,
            "path": str(item["path"]),
            "size": int(item.get("size") or (Path(item["path"]).stat().st_size if Path(item["path"]).is_file() else 0)),
            "content_match": bool((conflicts.get(conflict_key) or {}).get("content_match")),
        })

    # Safe last-resort fallback for a one-file upload/one detected conflict.
    # Never assign a conflict to an arbitrary file in a multi-file batch.
    if not result and len(unmatched) == 1 and len(conflicts) == 1:
        index, item, filename = unmatched[0]
        conflict_key = next(iter(conflicts))
        result.append({
            "index": index,
            "norm": normalize_filename(filename),
            "conflict_norm": conflict_key,
            "filename": filename,
            "path": str(item["path"]),
            "size": int(item.get("size") or (Path(item["path"]).stat().st_size if Path(item["path"]).is_file() else 0)),
            "content_match": bool((conflicts.get(conflict_key) or {}).get("content_match")),
        })
    return sorted(result, key=lambda entry: int(entry["index"]))


async def _process_batch_files(
    bot: Bot, tg_id: int, items: list[dict], language: str,
    replace_names: set[str] | None = None,
    replace_paths: set[str] | dict[str, set[str]] | None = None,
    replace_ids: set[int] | dict[str, set[int]] | None = None,
):
    names = "\n".join("• " + escape_html(x["filename"]) for x in items[:12])
    if len(items) > 12:
        names += "\n• " + ("and " if language == "en" else "тағы " if language == "kz" else "и ещё ") + str(len(items) - 12)
    try:
        await notify_user(bot, tg_id, "file_processed", tr(language, "batch_received_title"), tr(language, "batch_received_body", count=len(items), names=names))
    except Exception:
        log.exception("Could not send batch acceptance notification tg_id=%s", tg_id)

    processable = [item for item in items if item.get("path") and not item.get("error")]
    failed_names = [item["filename"] for item in items if not item.get("path") or item.get("error")]
    results = await asyncio.gather(
        *(process_price_file(bot, tg_id, item["filename"], Path(item["path"]), int(item.get("size", 0)), None, False) for item in processable),
        return_exceptions=True,
    )
    good = []
    good_items = []
    bad = list(failed_names)
    products = sets = components = review = 0
    for item, result in zip(processable, results):
        if isinstance(result, BaseException):
            log.error("Batch item raised for tg_id=%s filename=%r", tg_id, item.get("filename"), exc_info=(type(result), result, result.__traceback__))
            bad.append(item["filename"])
            continue
        if result and result.get("ok"):
            good.append(result["filename"])
            good_items.append(item)
            stats = result.get("stats") or {}
            products += int(stats.get("products", 0))
            sets += int(stats.get("sets", 0))
            components += int(stats.get("components", 0))
            review += int(stats.get("review", 0))
        else:
            bad.append((result or {}).get("filename", item["filename"]))
    if replace_names and good_items:
        try:
            await replace_existing_named_files(tg_id, replace_names, good_items, extra_old_paths=replace_paths, extra_old_ids=replace_ids)
        except Exception:
            # Keep both old catalogue records and successfully processed new files if
            # the replacement transaction fails; a later retry/manual cleanup is safer
            # than losing the existing catalogue.
            log.exception("New batch succeeded but replacement commit failed tg_id=%s", tg_id)
    lines = [tr(language, "batch_result_success", good=len(good), total=len(items))]
    if good:
        lines.append(tr(language, "batch_result_ok_files", names=", ".join(good[:8]) + (f" (+{len(good)-8})" if len(good) > 8 else "")))
    if bad:
        lines.append(tr(language, "batch_result_bad_files", names=", ".join(bad[:8]) + (f" (+{len(bad)-8})" if len(bad) > 8 else "")))
    if good:
        lines.append(tr(language, "batch_result_stats", products=products, sets=sets, components=components, review=review))
    try:
        await notify_user(bot, tg_id, "file_processed", tr(language, "batch_result_title"), "\n".join(lines))
    except Exception:
        log.exception("Could not send batch result notification tg_id=%s", tg_id)

async def _flush_batch_later(bot: Bot, tg_id: int):
    current_task = asyncio.current_task()
    loop = asyncio.get_running_loop()
    try:
        while True:
            queue = _batch_queues.get(tg_id, [])
            if not queue:
                _batch_last_activity.pop(tg_id, None)
                return
            delay = MEDIA_GROUP_COALESCE_SECONDS if any(item.get("media_group_id") for item in queue) else BATCH_COALESCE_SECONDS
            last_activity = _batch_last_activity.get(tg_id, loop.time())
            remaining = delay - (loop.time() - last_activity)
            if remaining > 0:
                await asyncio.sleep(remaining)
                continue
            snapshot = list(queue)
            activity_snapshot = _batch_last_activity.get(tg_id)
            downloads = [item.get("download_task") for item in snapshot if item.get("download_task")]
            if downloads:
                await asyncio.gather(*downloads, return_exceptions=True)
            # The event loop may have received more documents while downloads were running.
            if _batch_last_activity.get(tg_id) != activity_snapshot or len(_batch_queues.get(tg_id, [])) != len(snapshot):
                continue
            files = _batch_queues.pop(tg_id, [])
            _batch_last_activity.pop(tg_id, None)
            if _batch_tasks.get(tg_id) is current_task:
                _batch_tasks.pop(tg_id, None)
            break
        if not files:
            return
        language = await get_language_or_default(tg_id)
        for item in files:
            if item.get("error") == "unsupported":
                item["technical_error"] = "unsupported format"
            elif item.get("error") == "too_large":
                item["technical_error"] = "file exceeds configured size"
        conflicts = await get_existing_filename_conflicts(tg_id, files)
        if conflicts:
            token = secrets.token_hex(6)
            conflict_items = _build_conflict_items(files, conflicts)
            if not conflict_items:
                # Fail closed: never show an active confirm button if conflicts could
                # not be associated with specific incoming files.
                log.error(
                    "Detected duplicate conflicts but could not map them to incoming files; refusing to process tg_id=%s conflicts=%r files=%r",
                    tg_id, list(conflicts.keys()), [x.get("filename") for x in files],
                )
                try:
                    await bot.send_message(
                        chat_id=tg_id,
                        text={
                            "ru": "Обнаружен конфликт файлов, но не удалось определить, к каким загрузкам он относится. Данные не изменены. Отправьте файлы ещё раз.",
                            "en": "A file conflict was detected, but it could not be matched to a specific upload. No data was changed. Please upload the files again.",
                            "kz": "Файл қайшылығы анықталды, бірақ нақты жүктемені анықтау мүмкін болмады. Деректер өзгертілмеді. Файлдарды қайта жіберіңіз.",
                        }.get(language, "Обнаружен конфликт файлов, но не удалось определить, к каким загрузкам он относится. Данные не изменены. Отправьте файлы ещё раз."),
                    )
                except Exception:
                    log.exception("Could not report unmatched duplicate conflict tg_id=%s", tg_id)
                for item in files:
                    path = item.get("path")
                    try:
                        if path and Path(path).is_file() and Path(path).resolve().is_relative_to(settings.data_dir.resolve()):
                            Path(path).unlink()
                    except Exception:
                        log.exception("Could not clean unmatched duplicate upload %r", path)
                return
            PENDING_BATCHES[token] = {
                "tg_id": int(tg_id), "files": files, "conflicts": conflicts,
                "conflict_items": conflict_items, "choices": {}, "created_at": time.monotonic(),
            }
            try:
                prompt_text = {
                    "ru": "В группе есть файлы с похожими именами. Для каждого выберите действие, затем подтвердите общий результат.",
                    "en": "Some files in this batch have similar names. Choose an action for each, then confirm the overall result.",
                    "kz": "Топта атаулары ұқсас файлдар бар. Әрқайсысы үшін әрекетті таңдап, жалпы нәтижені растаңыз.",
                }.get(language, "В группе есть файлы с похожими именами. Для каждого выберите действие, затем подтвердите общий результат.")
                sent = await bot.send_message(
                    chat_id=tg_id,
                    text=prompt_text,
                    reply_markup=replacement_keyboard(token, language, conflict_items, PENDING_BATCHES[token]["choices"]),
                )
                PENDING_BATCHES[token]["prompt_message_id"] = int(sent.message_id)
                task = asyncio.create_task(_expire_pending_batch(token, PENDING_BATCH_TTL_SECONDS), name="pending-upload-expiry")
                _background_tasks.add(task)
                task.add_done_callback(_background_tasks.discard)
            except Exception:
                log.exception("Could not ask for per-file duplicate-upload confirmation tg_id=%s", tg_id)
                pending = PENDING_BATCHES.pop(token, None)
                for item in (pending or {}).get("files", []):
                    path = item.get("path")
                    try:
                        if path and Path(path).is_file() and Path(path).resolve().is_relative_to(settings.data_dir.resolve()):
                            Path(path).unlink()
                    except Exception:
                        log.exception("Could not clean staged duplicate upload after prompt failure: %r", path)
            return
        await _process_batch_files(bot, tg_id, files, language)
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("Could not process upload batch for tg_id=%s", tg_id)
        try:
            language = await get_language_or_default(tg_id)
            await notify_user(bot, tg_id, "file_processed", tr(language, "batch_failed_title"), tr(language, "batch_failed_body"))
        except Exception:
            log.exception("Could not report upload batch failure tg_id=%s", tg_id)
    finally:
        if _batch_tasks.get(tg_id) is current_task:
            _batch_tasks.pop(tg_id, None)
    await call.answer()
