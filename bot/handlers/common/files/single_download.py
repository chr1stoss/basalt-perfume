from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *
from bot.handlers.common.files.path import safe_data_file_path
from bot.handlers.common.keyboards.subscription import document_keyboard
from bot.handlers.common.notifications import send_notice

async def send_one_download(bot: Bot, chat_id: int, tg_id: int, row, language: str):
    filename, filepath, status = row
    path = safe_data_file_path(filepath)
    if str(status).lower() != "ready" or not path:
        await send_notice(bot, chat_id, tg_id, tr(language, "download_unavailable_title"), tr(language, "download_unavailable_body"), language)
        return False
    await bot.send_document(
        chat_id=chat_id,
        document=FSInputFile(str(path), filename=Path(filename).name),
        caption=tr(language, "download_sent_caption", filename=escape_html(Path(filename).name)),
        reply_markup=document_keyboard(language),
        parse_mode="HTML",
    )
    return True
