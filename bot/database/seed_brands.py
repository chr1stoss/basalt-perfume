"""Populate DB brand dictionaries and backfill products.brand_id from bundled JSON files.

Run after applying the DB migrations:
    python -m bot.database.seed_brands
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import logging
from pathlib import Path
import sys

from bot.database.connection import init_db, close_db, pool

ROOT = Path(__file__).resolve().parents[2]
ENGINE_PATH = ROOT / "bot" / "services" / "sort" / "parser_engine.py"
REFERENCE = ROOT / "bot" / "services" / "sort" / "reference"
log = logging.getLogger("basalt.seed_brands")


def load_engine():
    spec = importlib.util.spec_from_file_location("basalt_seed_parser_engine", ENGINE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Не удалось загрузить движок распознавания брендов: {ENGINE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


async def run() -> dict[str, int]:
    engine = load_engine()
    index = engine.build_brand_index(REFERENCE / "brands_all.json", REFERENCE / "brand_aliases.json")
    counters = {"brands_inserted": 0, "aliases_inserted": 0, "products_linked": 0}
    await init_db()
    try:
        async with pool().acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT id, normalized_name FROM brands")
                brand_ids = {str(norm): int(brand_id) for brand_id, norm in await cur.fetchall() if norm}
                # JSON dictionaries are the maintained source of truth; persist them once.
                for brand in index.brands:
                    name = str(brand.get("name") or "").strip()
                    norm = str(brand.get("normalized_name") or engine.normalize_brand(name)).strip()
                    if not name or not norm:
                        continue
                    if norm not in brand_ids:
                        await cur.execute(
                            "INSERT INTO brands(name,normalized_name,sources_json,aliases_json) VALUES(%s,%s,%s,%s)",
                            (name[:255], norm[:255], json.dumps(brand.get("sources") or [], ensure_ascii=False), json.dumps(brand.get("aliases") or [], ensure_ascii=False)),
                        )
                        brand_ids[norm] = int(cur.lastrowid)
                        counters["brands_inserted"] += 1
                await cur.execute("SELECT normalized_alias,canonical_brand FROM brand_aliases")
                alias_pairs = {(str(a), str(c)) for a, c in await cur.fetchall() if a and c}
                for item in index.alias_rows:
                    alias = str(item.get("alias") or "").strip()
                    norm = str(item.get("normalized_alias") or "").strip()
                    canonical = str(item.get("canonical") or "").strip()
                    if not alias or not norm or not canonical or (norm, canonical) in alias_pairs:
                        continue
                    bid = brand_ids.get(engine.normalize_brand(canonical))
                    await cur.execute(
                        "INSERT INTO brand_aliases(alias,normalized_alias,canonical_brand,brand_id,source,confidence,ambiguous) VALUES(%s,%s,%s,%s,%s,%s,%s)",
                        (alias[:255], norm[:255], canonical[:255], bid, str(item.get("source") or "brand_dictionary")[:100], item.get("confidence"), int(item.get("ambiguous") or 0)),
                    )
                    alias_pairs.add((norm, canonical))
                    counters["aliases_inserted"] += 1
                # Backfill links for previously imported products, leaving unknown brands NULL.
                await cur.execute("SELECT id,brand,brand_id FROM products WHERE brand IS NOT NULL AND brand<>''")
                updates = []
                for product_id, brand_name, current_id in await cur.fetchall():
                    normalized = engine.normalize_brand(brand_name)
                    wanted_id = brand_ids.get(normalized)
                    if wanted_id and int(current_id or 0) != wanted_id:
                        updates.append((wanted_id, int(product_id)))
                if updates:
                    await cur.executemany("UPDATE products SET brand_id=%s WHERE id=%s", updates)
                    counters["products_linked"] = len(updates)
            await conn.commit()
    finally:
        await close_db()
    return counters


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    results = await run()
    log.info("Справочник брендов обновлён: %s", ", ".join(f"{k}={v}" for k, v in results.items()))


if __name__ == "__main__":
    asyncio.run(main())
