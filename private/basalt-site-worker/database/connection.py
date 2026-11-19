"""Small MySQL connection pool used only by the website upload worker."""
from __future__ import annotations

import logging
import aiomysql

from config import settings

log = logging.getLogger(__name__)
_pool = None


async def init_db() -> None:
    global _pool
    if _pool is not None:
        return
    required = {
        "MYSQL_HOST": settings.mysql_host,
        "MYSQL_USER": settings.mysql_user,
        "MYSQL_DATABASE": settings.mysql_database,
        "MYSQL_PASSWORD": settings.mysql_password,
    }
    missing = [name for name, value in required.items() if not value or value.startswith("REPLACE_")]
    if missing:
        raise RuntimeError(
            "Заполните параметры " + ", ".join(missing)
            + " в /home/<логин>/private/basalt-site-worker/.env"
        )
    maxsize = max(1, min(int(settings.mysql_pool_size), 4))
    minsize = max(0, min(int(settings.mysql_pool_minsize), maxsize))
    log.info("Opening website worker MySQL pool (minsize=%s, maxsize=%s)", minsize, maxsize)
    _pool = await aiomysql.create_pool(
        host=settings.mysql_host,
        port=settings.mysql_port,
        user=settings.mysql_user,
        password=settings.mysql_password,
        db=settings.mysql_database,
        charset="utf8mb4",
        autocommit=False,
        minsize=minsize,
        maxsize=maxsize,
        connect_timeout=12,
        pool_recycle=1800,
    )


async def close_db() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        await _pool.wait_closed()
        _pool = None


def pool():
    if _pool is None:
        raise RuntimeError("MySQL pool не инициализирован. Сначала вызовите init_db().")
    return _pool
