from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *

def subscription_keyboard(language="ru"):
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=tr(language, "activate_extend"), callback_data="activate")],
        [InlineKeyboardButton(text=tr(language, "open_webapp"), web_app=WebAppInfo(url=settings.webapp_url))],
        [InlineKeyboardButton(text=tr(language, "back"), callback_data="home")],
    ])

def document_keyboard(language="ru"):
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=tr(language, "return_webapp"), web_app=WebAppInfo(url=settings.webapp_url))],
        [InlineKeyboardButton(text=tr(language, "delete_message"), callback_data="delete_download_message")],
    ])
