"""Configuration for the isolated website price-list worker."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env", override=False)
HOME_ROOT = ROOT.parent.parent


def _int_env(name: str, default: int, minimum: int = 0, maximum: int = 100000) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


@dataclass(frozen=True)
class Settings:
    mysql_host: str = os.getenv("MYSQL_HOST", "").strip()
    mysql_port: int = _int_env("MYSQL_PORT", 3306, 1, 65535)
    mysql_user: str = os.getenv("MYSQL_USER", "").strip()
    mysql_password: str = os.getenv("MYSQL_PASSWORD", "")
    mysql_database: str = os.getenv("MYSQL_DATABASE", "").strip()
    mysql_pool_size: int = _int_env("MYSQL_POOL_SIZE", 2, 1, 4)
    mysql_pool_minsize: int = _int_env("MYSQL_POOL_MINSIZE", 1, 0, 2)
    max_concurrent_files: int = _int_env("MAX_CONCURRENT_FILES", 1, 1, 1)
    log_level: str = os.getenv("LOG_LEVEL", "INFO").strip().upper()
    upload_storage_dir: Path = Path(
        os.getenv("UPLOAD_STORAGE_DIR", str(HOME_ROOT / "uploaded_filed"))
    ).expanduser().resolve()
    log_dir: Path = Path(
        os.getenv("WORKER_LOG_DIR", str(HOME_ROOT / "private-logs"))
    ).expanduser().resolve()


settings = Settings()
