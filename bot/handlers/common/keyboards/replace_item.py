from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *


def replacement_item_keyboard(token: str, index: int, language="ru", choice: str | None = None):
    replace_text = {"ru": "Заменить", "en": "Replace", "kz": "Ауыстыру"}.get(language, "Заменить")
    keep_text = {"ru": "Отменить", "en": "Keep old", "kz": "Ескісін қалдыру"}.get(language, "Отменить")
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text=("✓ " if choice == "replace" else "") + replace_text, callback_data=f"replace_item:{token}:{index}:replace"),
        InlineKeyboardButton(text=("✓ " if choice == "keep" else "") + keep_text, callback_data=f"replace_item:{token}:{index}:keep"),
    ]])


def replacement_confirm_keyboard(token: str, language="ru"):
    # Compatibility helper; the active workflow uses replacement_keyboard().
    from bot.handlers.common.keyboards.replacement import replacement_keyboard
    return replacement_keyboard(token, language)
