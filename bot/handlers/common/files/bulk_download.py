from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *
from bot.handlers.common.files.path import safe_data_file_path
from bot.handlers.common.keyboards.download_group import download_group_keyboard
from bot.handlers.common.keyboards.subscription import document_keyboard
from bot.handlers.common.notifications import send_notice

async def send_all_downloads(bot: Bot, chat_id: int, tg_id: int, language: str, owner_tg_id: int | None = None):
    list_owner_id = int(owner_tg_id if owner_tg_id is not None else tg_id)
    try:
        async with pool().acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT filename,filepath,status FROM price_lists WHERE owner_tg_id=%s AND status='ready' ORDER BY imported_at DESC,id DESC",
                    (list_owner_id,),
                )
                rows = await cur.fetchall()
    except Exception:
        log.exception("Could not query price lists for bulk download owner_tg_id=%s", list_owner_id)
        await send_notice(bot, chat_id, tg_id, tr(language, "download_unavailable_title"), tr(language, "download_unavailable_body"), language)
        return
    documents = []
    for row in rows:
        filename, filepath, status = row
        path = safe_data_file_path(filepath)
        if str(status).lower() == "ready" and path:
            documents.append((Path(filename).name, path))
    if not documents:
        await send_notice(bot, chat_id, tg_id, tr(language, "download_all_none_title"), tr(language, "download_all_none_body"), language)
        return
    if len(documents) == 1:
        await bot.send_document(
            chat_id=chat_id,
            document=FSInputFile(str(documents[0][1]), filename=documents[0][0]),
            caption=tr(language, "download_sent_caption", filename=escape_html(documents[0][0])),
            reply_markup=document_keyboard(language),
            parse_mode="HTML",
        )
        return
    # Telegram sendMediaGroup supports at most 10 documents per album and does not
    # accept reply_markup, so large catalogues are emitted as consecutive albums.
    chunks = [documents[i:i + 10] for i in range(0, len(documents), 10)]
    sent_album_ids: list[int] = []
    token = secrets.token_hex(8)
    try:
        for index, chunk in enumerate(chunks, 1):
            media = []
            for item_index, (filename, path) in enumerate(chunk):
                media.append(InputMediaDocument(
                    media=FSInputFile(str(path), filename=filename),
                    caption=tr(language, "download_all_caption", part=f"{index}/{len(chunks)}") if item_index == 0 else None,
                    parse_mode="HTML" if item_index == 0 else None,
                ))
            sent_album = await bot.send_media_group(chat_id=chat_id, media=media)
            sent_album_ids.extend(int(sent.message_id) for sent in sent_album)
        control = await bot.send_message(
            chat_id=chat_id,
            text=tr(language, "download_all_summary", count=len(documents)),
            reply_markup=download_group_keyboard(token, language),
        )
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("Bulk download failed tg_id=%s files=%s; cleaning partially sent albums", tg_id, len(documents))
        for sent_id in sent_album_ids:
            try:
                await bot.delete_message(chat_id=chat_id, message_id=sent_id)
            except TelegramBadRequest as delete_exc:
                if not any(marker in str(delete_exc).lower() for marker in ("message to delete not found", "message_id_invalid", "message identifier is not specified", "too late", "message can't be deleted", "message can\'t be deleted")):
                    log.warning("Could not clean partially sent download message_id=%s: %s", sent_id, delete_exc)
            except Exception:
                log.exception("Could not clean partially sent download message_id=%s", sent_id)
        await send_notice(bot, chat_id, tg_id, tr(language, "download_failed_title"), tr(language, "download_failed_body"), language)
        return
    DOWNLOAD_GROUPS[token] = {
        "tg_id": int(tg_id), "chat_id": int(chat_id),
        "album_message_ids": sent_album_ids, "control_message_id": int(control.message_id),
        "created_at": time.monotonic(),
    }
    task = asyncio.create_task(_expire_download_group(token, 60 * 60), name="bulk-download-controls-expiry")
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

async def _expire_download_group(token: str, delay: float):
    await asyncio.sleep(delay)
    DOWNLOAD_GROUPS.pop(token, None)
