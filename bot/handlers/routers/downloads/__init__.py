"""Downloads handlers."""
from aiogram import Router

router = Router(name="basalt-downloads")

from .commands import router as _commands_router
from .actions import router as _actions_router

router.include_router(_commands_router)
router.include_router(_actions_router)
