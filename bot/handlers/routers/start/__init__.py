"""Start handlers."""
from aiogram import Router

router = Router(name="basalt-start")

from .entry import router as _entry_router
from .preview import router as _preview_router

router.include_router(_entry_router)
router.include_router(_preview_router)
