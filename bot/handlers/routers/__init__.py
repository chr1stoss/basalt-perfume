"""Aggregate all feature routers and apply cross-cutting middleware once."""
from aiogram import Router
from bot.handlers.common.middleware import MaintenanceMiddleware, BannedCallbackMiddleware

router = Router(name="basalt-main")
router.callback_query.middleware(BannedCallbackMiddleware())
router.callback_query.middleware(MaintenanceMiddleware())
router.message.middleware(MaintenanceMiddleware())

from .start import router as start_router
from .downloads import router as downloads_router
from .subscription import router as subscription_router
from .catalogue import router as catalogue_router
from .price_lists import router as price_lists_router
from .system import router as system_router

router.include_router(start_router)
router.include_router(downloads_router)
router.include_router(subscription_router)
router.include_router(catalogue_router)
router.include_router(price_lists_router)
router.include_router(system_router)

__all__ = ["router"]
