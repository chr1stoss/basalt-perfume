"""System handlers."""
from aiogram import Router

router = Router(name="basalt-system")

from .errors import router as _errors_router
from .fallback import router as _fallback_router

router.include_router(_errors_router)
router.include_router(_fallback_router)
