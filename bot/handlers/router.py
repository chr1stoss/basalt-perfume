"""Backward-compatible router import; implementation lives in feature packages."""
from bot.handlers.routers import router

__all__ = ["router"]
