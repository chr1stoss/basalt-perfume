"""Catalogue handlers."""
from aiogram import Router

router = Router(name="basalt-catalogue")

from .navigation import router as _navigation_router
from .notifications import router as _notifications_router

router.include_router(_navigation_router)
router.include_router(_notifications_router)
