"""Runtime state shared by the bot's feature routers."""
from pathlib import Path
import asyncio
import time

from bot.config import settings

ASSETS = Path(__file__).resolve().parents[3] / "assets"
LOGO = ASSETS / "none" / "logo.jpg"
MAIN_IMAGE = ASSETS / "ru" / "main.jpg"
UPLOAD_IMAGE = ASSETS / "ru" / "how_upload.jpg"
ACTIVATION_IMAGE = ASSETS / "ru" / "activation.jpg"

def image_for(language: str | None, kind: str) -> Path:
    """Return localized bot artwork: English gets en/, Russian and Kazakh get ru/."""
    lang = str(language or "ru").strip().lower().replace("_", "-")
    lang = "en" if lang == "en" or lang.startswith("en-") else "ru"
    filename = {"main": "main.jpg", "upload": "how_upload.jpg", "activation": "activation.jpg"}.get(kind)
    if filename is None:
        raise ValueError(f"Unknown localized image kind: {kind}")
    candidate = ASSETS / lang / filename
    return candidate if candidate.is_file() else ASSETS / "ru" / filename
ALLOWED = {".xls", ".xlsx", ".xlsm", ".csv", ".tsv", ".txt"}

# Telegram menu/download/batch state shared across route modules.
MAIN_MESSAGES: dict[int, tuple[int, int]] = {}
PENDING_BATCHES: dict[str, dict] = {}
DOWNLOAD_GROUPS: dict[str, dict] = {}
_batch_queues: dict[int, list[dict]] = {}
_batch_tasks: dict[int, asyncio.Task] = {}
_batch_last_activity: dict[int, float] = {}
_background_tasks: set[asyncio.Task] = set()
BATCH_COALESCE_SECONDS = 4.5
MEDIA_GROUP_COALESCE_SECONDS = 7.5
PENDING_BATCH_TTL_SECONDS = 15 * 60
NOTICE_TTL_SECONDS = 90

__all__ = [
    "ASSETS", "LOGO", "MAIN_IMAGE", "UPLOAD_IMAGE", "ACTIVATION_IMAGE", "image_for", "ALLOWED",
    "MAIN_MESSAGES", "PENDING_BATCHES", "DOWNLOAD_GROUPS", "_batch_queues", "_batch_tasks",
    "_batch_last_activity", "_background_tasks", "BATCH_COALESCE_SECONDS", "MEDIA_GROUP_COALESCE_SECONDS",
    "PENDING_BATCH_TTL_SECONDS", "NOTICE_TTL_SECONDS", "settings",
]
