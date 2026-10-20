import logging
from urllib.parse import urlsplit

from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *

log = logging.getLogger(__name__)

def _valid_webapp_url(value: str) -> bool:
    """Telegram WebApp buttons require an absolute HTTPS URL with a hostname."""
    try:
        parsed = urlsplit((value or "").strip())
        return parsed.scheme.lower() == "https" and bool(parsed.hostname)
    except (TypeError, ValueError):
        return False

def main_keyboard(language="ru", role="none"):
    language = normalize_language(language)
    rows = []
    webapp_url = (settings.webapp_url or "").strip()
    if _valid_webapp_url(webapp_url):
        rows.append([InlineKeyboardButton(text=tr(language, "open_webapp"), web_app=WebAppInfo(url=webapp_url))])
    else:
        # A stale HTTP/empty WEBAPP_URL must not prevent /start from replying at all.
        log.warning("WEBAPP_URL is missing or invalid for Telegram WebApp; expected an absolute HTTPS URL")
    rows.extend([
        [InlineKeyboardButton(text=tr(language, "activate_extend"), callback_data="activate")],
        # Upload instructions are informational and available to everyone, regardless of role.
        [InlineKeyboardButton(text=tr(language, "how_upload"), callback_data="how_upload")],
    ])
    return InlineKeyboardMarkup(inline_keyboard=rows)

def back_keyboard(language="ru"):
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=tr(language, "back"), callback_data="home")]
    ])
