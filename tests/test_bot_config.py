"""Configuration tests for bot-specific settings."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_bot_proxy_reader_ignores_comment_lines_and_rejects_invalid_urls(monkeypatch):
    from bot.config import _read_bot_proxy

    monkeypatch.setenv("BOT_PROXY", "#socks5://proxy.example:1080")
    assert _read_bot_proxy() == ""
    monkeypatch.setenv("BOT_PROXY", "not-a-proxy")
    assert _read_bot_proxy() == ""
    monkeypatch.setenv("BOT_PROXY", "socks5://proxy.example:1080")
    assert _read_bot_proxy() == "socks5://proxy.example:1080"


def test_bot_api_timeout_is_bounded_and_default_is_documented_in_config():
    source = (ROOT / "bot/config.py").read_text(encoding="utf-8")
    assert "max(5.0, min(30.0, float(os.getenv('BOT_API_TIMEOUT', '12'))))" in source
    assert "BOT_PROXY is invalid; starting without a proxy" in source
    assert "Optional proxy used only for this bot's Telegram Bot API calls" in source
