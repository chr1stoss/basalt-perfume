"""Shared imports and configured dependencies used by handler modules."""
from .base import *  # noqa: F401,F403 - preserves the shared handler dependency surface
__all__ = [name for name in globals() if not name.startswith("_")]
