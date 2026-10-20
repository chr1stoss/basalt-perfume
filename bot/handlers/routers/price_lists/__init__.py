"""Price Lists handlers."""
from aiogram import Router

router = Router(name="basalt-price-lists")

from .duplicate_review import router as _duplicate_review_router
from .duplicate_edit import router as _duplicate_edit_router
from .duplicate_cancel import router as _duplicate_cancel_router
from .upload import router as _upload_router

router.include_router(_duplicate_review_router)
router.include_router(_duplicate_edit_router)
router.include_router(_duplicate_cancel_router)
router.include_router(_upload_router)
