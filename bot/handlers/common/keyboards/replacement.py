from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *
from bot.handlers.common.keyboards.replace_item import replacement_item_keyboard


def replacement_keyboard(token: str, language="ru", items=None, choices=None):
    """Single-message conflict chooser: dynamic file rows first, fixed actions last."""
    items = items or []
    choices = choices or {}
    ru = language != "en" and language != "kz"
    confirm_text = {"ru": "Подтвердить выбранные действия", "en": "Confirm selected actions", "kz": "Таңдалған әрекеттерді растау"}.get(language, "Подтвердить выбранные действия")
    cancel_text = {"ru": "Отменить группу", "en": "Cancel batch", "kz": "Топтан бас тарту"}.get(language, "Отменить группу")
    rows = []
    for item in items:
        index = int(item["index"])
        choice = choices.get(index, choices.get(str(index)))
        if choice == "replace":
            mark = "✓ "
        elif choice == "keep":
            mark = "✕ "
        else:
            mark = "○ "
        name = str(item.get("filename") or "Файл")
        # Keep Telegram's button label within a comfortable length.
        if len(name) > 48:
            name = name[:45] + "…"
        rows.append([InlineKeyboardButton(text=mark + name, callback_data=f"replace_open:{token}:{index}")])
    # No active confirm action is rendered for an invalid/empty choice list.
    # The callback handler also validates this server-side as a second safeguard.
    if items:
        rows.append([InlineKeyboardButton(text=confirm_text, callback_data="replace_confirm_choices:" + token)])
    rows.append([InlineKeyboardButton(text=cancel_text, callback_data="cancel_choices:" + token)])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def replacement_summary_keyboard(token: str, language="ru"):
    # Kept as a compatibility alias for any older callers.
    return replacement_keyboard(token, language)
