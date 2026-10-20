"""Subscription handlers."""
from aiogram import Router

router = Router(name="basalt-subscription")

from .commands import router as _commands_router
from .activation import router as _activation_router

router.include_router(_commands_router)
router.include_router(_activation_router)
