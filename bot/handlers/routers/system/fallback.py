from aiogram import Router
from bot.handlers.common import *

router = Router(name="basalt-fallback")

@router.message(F.text.startswith("/"))
async def delete_other_commands(message: Message):
    await delete_user_message(message)
