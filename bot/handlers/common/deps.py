import asyncio
import hashlib
import logging
import re
import secrets
import time
from datetime import datetime
from pathlib import Path

from aiogram import Bot, F, Router
from aiogram import BaseMiddleware
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (
    CallbackQuery,
    ErrorEvent,
    FSInputFile,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    InputMediaDocument,
    InputMediaPhoto,
    Message,
    WebAppInfo,
)

from bot.config import settings
from bot.core.i18n import normalize_language, tr
from bot.database.connection import pool
from bot.database.queries.users import (
    get_user_role,
    get_user_language,
    get_saved_menu_message,
    save_menu_message,
    has_active_subscription,
    set_user_language,
    upsert_user,
)
from bot.services.notifications import escape_html, notify_user
from bot.services.file_names import normalize_filename
from bot.services.parser.price_list import process_price_file

log = logging.getLogger("basalt-main")
