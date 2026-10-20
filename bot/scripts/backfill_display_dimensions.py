#!/usr/bin/env python3
"""Backfill parsed dimensions for existing DISPLAY/SHOWCARD/BILLBOARD products.

Run after applying migration 12_display_product_dimensions.sql:
    python -m bot.scripts.backfill_display_dimensions
The script reads existing raw titles/cells and updates only the new size columns plus
clears obsolete volume fields for recognized display products.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import aiomysql

from bot.database.connection import init_db, close_db, pool
from bot.services.sort.parser_engine import extract_display_dimensions

log = logging.getLogger(__name__)
DISPLAY_TYPES = {"DISPLAY", "SHOWCARD", "BILLBOARD"}


def _cell(cells: Any, roles: Any, role: str) -> Any:
    if not isinstance(cells, list) or not isinstance(roles, dict):
        return None
    index = roles.get(role)
    if not isinstance(index, int) or index < 0 or index >= len(cells):
        return None
    return cells[index]


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    await init_db()
    changed = 0
    untouched = 0
    try:
        async with pool().acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    "SELECT p.id,p.type,p.name,p.raw_title,p.raw_cells_json,sr.column_roles_json "
                    "FROM products p LEFT JOIN source_rows sr ON sr.id=p.source_row_id "
                    "WHERE UPPER(COALESCE(p.type,'')) IN ('DISPLAY','SHOWCARD','BILLBOARD') "
                    "AND (p.size_width IS NULL OR p.size_height IS NULL OR p.size_unit IS NULL) "
                    "ORDER BY p.id"
                )
                rows = await cur.fetchall()
                for row in rows:
                    try:
                        cells = json.loads(row.get("raw_cells_json") or "[]")
                    except (TypeError, ValueError):
                        cells = []
                    try:
                        roles = json.loads(row.get("column_roles_json") or "{}")
                    except (TypeError, ValueError):
                        roles = {}
                    raw_title = str(row.get("raw_title") or "")
                    name = str(row.get("name") or "")
                    size_cell = _cell(cells, roles, "size")
                    width_cell = _cell(cells, roles, "width")
                    height_cell = _cell(cells, roles, "height")
                    source = " ".join(str(v) for v in (raw_title, name, size_cell) if v not in (None, ""))
                    dims = extract_display_dimensions(source, width_cell, height_cell)
                    width = dims.get("size_width")
                    height = dims.get("size_height")
                    unit = dims.get("size_unit")
                    if width and height and unit in ("mm", "cm"):
                        await cur.execute(
                            "UPDATE products SET display_kind=%s,size_width=%s,size_height=%s,size_unit=%s,volume_ml=NULL,volume_text=NULL WHERE id=%s",
                            (str(row.get("type") or "").lower(), width, height, unit, int(row["id"])),
                        )
                        changed += cur.rowcount
                    else:
                        await cur.execute(
                            "UPDATE products SET display_kind=%s,volume_ml=NULL,volume_text=NULL WHERE id=%s",
                            (str(row.get("type") or "").lower(), int(row["id"])),
                        )
                        untouched += 1
                    if (changed + untouched) % 250 == 0:
                        await conn.commit()
                        log.info("Обработано строк: %s", changed + untouched)
                await conn.commit()
        log.info("Готово. Заполнены размеры: %s; размеров не найдено: %s", changed, untouched)
    finally:
        await close_db()


if __name__ == "__main__":
    asyncio.run(main())
