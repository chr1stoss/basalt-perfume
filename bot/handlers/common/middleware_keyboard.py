"""Small callback utility used by account and maintenance guards."""
from bot.handlers.common.deps import *

async def make_inline_keyboard_inert(event):
    """Replace an interacted inline keyboard with inert callback buttons.

    Telegram Bot API does not currently expose a disabled/active=False flag for
    InlineKeyboardButton. Replacing actions with a no-op callback is the safest
    server-side equivalent once the locked keyboard is interacted with.
    """
    message = getattr(event, "message", None)
    markup = getattr(message, "reply_markup", None) if message is not None else None
    rows = getattr(markup, "inline_keyboard", None) if markup is not None else None
    if not rows:
        return
    try:
        inert = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text=(button.text or " "), callback_data="locked_noop") for button in row]
            for row in rows
        ])
        await message.edit_reply_markup(reply_markup=inert)
    except Exception:
        log.debug("Could not make locked inline keyboard inert", exc_info=True)
