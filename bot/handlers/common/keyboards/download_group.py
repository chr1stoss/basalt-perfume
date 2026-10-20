from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *

def download_group_keyboard(token: str, language="ru"):
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=tr(language, "return_webapp"), web_app=WebAppInfo(url=settings.webapp_url))],
        [InlineKeyboardButton(text=tr(language, "delete_message"), callback_data="delete_download_group:" + token)],
    ])

def notice_keyboard(language="ru"):
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=tr(language, "ok"), callback_data="dismiss_notice")]
    ])
