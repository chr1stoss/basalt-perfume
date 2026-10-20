from aiogram import Router
from bot.handlers.common import *

router = Router(name="basalt-upload")

@router.message(F.document)
async def upload_document(message: Message, bot: Bot):
    try:
        await upsert_user(message.from_user)
    except Exception:
        log.exception("Could not upsert uploader tg_id=%s", message.from_user.id)
    language = await get_language_or_default(message.from_user.id)
    role = await get_user_role(message.from_user.id)
    if role in ("buyer", "none"):
        await delete_user_message(message)
        message_text = ({
            "ru": "Для роли покупателя загрузка прайс-листов отключена. Откройте WebApp и воспользуйтесь поиском товаров.",
            "en": "Price-list uploads are disabled for buyer accounts. Open the WebApp and use product search.",
            "kz": "Сатып алушы рөлінде прайс-парақ жүктеу өшірілген. WebApp ашып, тауар іздеуді пайдаланыңыз.",
        } if role == "buyer" else {
            "ru": "Для доступа к приложению активируйте или продлите подписку в боте.",
            "en": "Activate or renew your subscription in the bot to get access.",
            "kz": "Қолданбаға кіру үшін ботта жазылымды іске қосыңыз немесе ұзартыңыз.",
        }).get(language, "Для доступа активируйте или продлите подписку в боте.")
        await show_view(bot, message.chat.id, message.from_user.id, image_for(language, "main"), message_text, main_keyboard(language, await get_user_role(message.from_user.id)))
        return
    doc = message.document
    filename = Path(doc.file_name or "price_list.xlsx").name
    ext = Path(filename).suffix.lower()
    if not await has_active_subscription(message.from_user.id):
        await delete_user_message(message)
        await show_view(bot, message.chat.id, message.from_user.id, image_for(language, "main"),
            tr(language, "need_subscription_title") + "\n\n" + tr(language, "need_subscription_upload"), subscription_keyboard(language))
        return
    item = {
        "filename": filename,
        "file_id": doc.file_id,
        "size": int(doc.file_size or 0),
        "media_group_id": message.media_group_id,
        "message_id": message.message_id,
        "path": None,
        "error": None,
    }
    if ext not in ALLOWED:
        item["error"] = "unsupported"
    elif doc.file_size and doc.file_size > settings.max_file_size_mb * 1024 * 1024:
        item["error"] = "too_large"
    # Enqueue before any Telegram API call: deleting the incoming message may be slow,
    # and must not delay the group coalescing clock or split one media group into two batches.
    tg_id = int(message.from_user.id)
    loop = asyncio.get_running_loop()
    _batch_queues.setdefault(tg_id, []).append(item)
    if not item.get("error"):
        task = asyncio.create_task(_download_queued_item(bot, tg_id, item), name=f"download-price-list-{tg_id}")
        item["download_task"] = task
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
    _batch_last_activity[tg_id] = loop.time()
    task = _batch_tasks.get(tg_id)
    if not task or task.done():
        _batch_tasks[tg_id] = asyncio.create_task(_flush_batch_later(bot, tg_id), name=f"flush-upload-batch-{tg_id}")
    await delete_user_message(message)
