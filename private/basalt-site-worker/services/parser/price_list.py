import asyncio, json, logging, os, re, sys, threading, random
from datetime import datetime
from pathlib import Path
from typing import Any
from config import settings

log=logging.getLogger(__name__)
ROOT=Path(__file__).resolve().parents[2]
ENGINE_DIR=ROOT/'services'/'sort'
REF=ENGINE_DIR/'reference'
_global_lock=asyncio.Lock()
_engine_lock=threading.Lock()
_db_write_lock=asyncio.Lock()
_semaphore=asyncio.Semaphore(settings.max_concurrent_files)
_engine=None
_brand_index=None


def _load_engine_and_parse(path: Path, original_filename: str) -> dict[str,Any]:
    global _engine,_brand_index
    import importlib.util
    with _engine_lock:
        if _engine is None:
            spec=importlib.util.spec_from_file_location('basalt_parser_engine',ENGINE_DIR/'parser_engine.py')
            if spec is None or spec.loader is None: raise RuntimeError('Не удалось загрузить движок парсера')
            module=importlib.util.module_from_spec(spec); sys.modules[spec.name]=module; spec.loader.exec_module(module); _engine=module
        engine=_engine
        if _brand_index is None:
            _brand_index=engine.build_brand_index(REF/'brands_all.json',REF/'brand_aliases.json')
    books=[]
    for sheet,matrix in engine.read_workbook(path): books.append((original_filename,sheet,matrix))
    rules=engine.load_json(REF/'parser_rules.json',{})
    set_rules=engine.load_json(REF/'set_patterns.json',{})
    data=engine.process_workbook_rows(books,rules,set_rules,_brand_index)
    if not data['products']:
        raise RuntimeError('В файле не распознано ни одной товарной строки. Проверьте заголовки столбцов и содержимое файла.')
    return data


def _json(value):
    return json.dumps(value,ensure_ascii=False,separators=(',',':'),default=str) if value is not None else None

async def _insert_many(cur, sql, rows, chunk=150):
    first_ids=[]
    for i in range(0,len(rows),chunk):
        batch=rows[i:i+chunk]
        if not batch: continue
        await cur.executemany(sql,batch)
        first_ids.append((i,int(cur.lastrowid),len(batch)))
    return first_ids

async def _persist_parsed_file_once(tg_id: int, filename: str, file_path: Path, size_bytes: int, data: dict[str,Any], price_list_id: int):
    from database.connection import pool
    src_rows=data['source_rows']; products=data['products']; components=data['components']
    async with pool().acquire() as conn:
        async with conn.cursor() as cur:
            await conn.begin()
            try:
                # Persist the canonical brand dictionary and alias rows into MySQL as part
                # of the same transaction; the parser also keeps this index in memory.
                engine = _engine
                brand_index = _brand_index
                brand_ids = {}
                if brand_index is not None:
                    await cur.execute('SELECT id,normalized_name FROM brands')
                    brand_ids = {str(norm): int(dbid) for dbid, norm in await cur.fetchall() if norm is not None}
                    brand_rows_to_add = []
                    for b in brand_index.brands:
                        norm = str(b.get('normalized_name') or engine.normalize_brand(b.get('name') or ''))
                        if not norm:
                            continue
                        if norm not in brand_ids:
                            brand_rows_to_add.append((str(b.get('name') or norm)[:255], norm[:255], _json(b.get('sources') or []), _json(b.get('aliases') or [])))
                    for row in brand_rows_to_add:
                        await cur.execute('INSERT INTO brands(name,normalized_name,sources_json,aliases_json) VALUES(%s,%s,%s,%s)', row)
                        brand_ids[row[1]] = int(cur.lastrowid)
                    await cur.execute('SELECT id,normalized_alias,canonical_brand FROM brand_aliases')
                    existing_aliases = {(str(n), str(c)) for _id, n, c in await cur.fetchall() if n is not None and c is not None}
                    aliases_to_add = []
                    for a in brand_index.alias_rows:
                        norm = str(a.get('normalized_alias') or '')
                        canonical = str(a.get('canonical') or '')
                        pair = (norm, canonical)
                        if not norm or not canonical or pair in existing_aliases:
                            continue
                        aliases_to_add.append((str(a.get('alias') or norm)[:255], norm[:255], canonical[:255], brand_ids.get(engine.normalize_brand(canonical)), str(a.get('source') or 'brand_aliases.json')[:100], a.get('confidence'), int(a.get('ambiguous') or 0)))
                        existing_aliases.add(pair)
                    if aliases_to_add:
                        await cur.executemany('INSERT INTO brand_aliases(alias,normalized_alias,canonical_brand,brand_id,source,confidence,ambiguous) VALUES(%s,%s,%s,%s,%s,%s,%s)', aliases_to_add)
                await cur.execute('SELECT price_multiplier FROM users WHERE tg_id=%s LIMIT 1', (int(tg_id),))
                user_multiplier_row = await cur.fetchone()
                product_multiplier = float(user_multiplier_row[0]) if user_multiplier_row and user_multiplier_row[0] is not None else 1.0
                product_multiplier = max(0.1, min(100.0, product_multiplier))
                src_values=[]
                for r in src_rows:
                    src_values.append((price_list_id,r['source_file'],r['source_sheet'],r['source_row_number'],r['row_status'],r.get('title_candidate'),r.get('raw_price'),_json(r.get('column_roles')),_json(r.get('raw_cells')),None,r.get('notes')))
                await _insert_many(cur,'INSERT INTO source_rows(price_list_id,source_file,source_sheet,source_row_number,row_status,title_candidate,raw_price,column_roles_json,raw_cells_json,product_id,notes) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',src_values)
                # Never infer auto-increment IDs from executemany(). Query actual IDs by the
                # stable source-row identity; auto-increment ranges may contain gaps.
                await cur.execute('SELECT id,source_file,source_sheet,source_row_number FROM source_rows WHERE price_list_id=%s',(price_list_id,))
                source_db_rows=await cur.fetchall()
                source_key_to_db={(str(r[1]),str(r[2] or ''),int(r[3])):int(r[0]) for r in source_db_rows}
                src_map={}
                for r in src_rows:
                    key=(str(r['source_file']),str(r.get('source_sheet') or ''),int(r['source_row_number']))
                    db_id=source_key_to_db.get(key)
                    if db_id is None:
                        raise RuntimeError('Не удалось сопоставить исходную строку прайс-листа с записью базы данных.')
                    src_map[int(r['id'])]=db_id

                prod_values=[]
                for p in products:
                    brand_name = p.get('brand')
                    brand_id = brand_ids.get(engine.normalize_brand(brand_name)) if brand_name and engine is not None else None
                    prod_values.append((src_map[p['source_row_id']],p.get('article'),p.get('article_raw'),brand_name,brand_id,p.get('brand_match_method'),p['name'],p.get('type'),p.get('category') or 'other',_json(p.get('defects') or []),p.get('volume_ml'),p.get('volume_text'),p.get('price_usd'),product_multiplier,p.get('price_raw'),p.get('currency') or 'USD',p.get('gender'),p.get('gender_from_name'),int(p.get('is_tester') or 0),int(p.get('is_sample') or 0),int(p.get('is_set') or 0),int(p.get('set_component_count') or 0),_json(p.get('extra_info') or []),p.get('raw_title') or p['name'],_json(p.get('raw_cells') or []),p.get('source_file') or filename,p.get('source_sheet') or '',p.get('source_row_number') or 0,p.get('parse_confidence') or 0,int(p.get('needs_review') or 0),_json(p.get('review_reasons') or [])))
                product_map={}
                prod_sql='INSERT INTO products(source_row_id,article,article_raw,brand,brand_id,brand_match_method,name,type,category,defects_json,volume_ml,volume_text,price_usd,price_multiplier,price_raw,currency,gender,gender_from_name,is_tester,is_sample,is_set,set_component_count,extra_info_json,raw_title,raw_cells_json,source_file,source_sheet,source_row_number,parse_confidence,needs_review,review_reasons_json) VALUES('+','.join(['%s']*31)+')'
                if prod_values:
                    await _insert_many(cur,prod_sql,prod_values)
                    db_source_ids=[src_map[int(p['source_row_id'])] for p in products]
                    # Query real product IDs through the FK column instead of relying on
                    # lastrowid arithmetic; this also makes retries/gaps safe.
                    source_product_map={}
                    for offset in range(0,len(db_source_ids),500):
                        chunk_ids=db_source_ids[offset:offset+500]
                        placeholders=','.join(['%s']*len(chunk_ids))
                        await cur.execute('SELECT id,source_row_id FROM products WHERE source_row_id IN ('+placeholders+')',tuple(chunk_ids))
                        for db_id,db_source_id in await cur.fetchall(): source_product_map[int(db_source_id)]=int(db_id)
                    for p in products:
                        db_source_id=src_map[int(p['source_row_id'])]
                        if db_source_id not in source_product_map:
                            raise RuntimeError('Не удалось сопоставить товар с исходной строкой прайс-листа.')
                        product_map[int(p['id'])]=source_product_map[db_source_id]
                    updates=[]
                    for p in products: updates.append((product_map[int(p['id'])],src_map[int(p['source_row_id'])]))
                    await cur.executemany('UPDATE source_rows SET product_id=%s WHERE id=%s',updates)

                comp_values=[]
                for c in components:
                    parent=product_map.get(c.get('parent_product_id'))
                    if not parent: continue
                    comp_values.append((parent,c.get('sequence_no') or 1,c.get('brand'),c.get('name') or 'Компонент набора',c.get('type'),c.get('category') or 'other',c.get('quantity') or 1,c.get('volume_ml'),c.get('volume_text'),c.get('gender'),c.get('raw_component') or c.get('name') or '',int(c.get('needs_review') or 0),_json(c.get('review_reasons') or [])))
                if comp_values:
                    await _insert_many(cur,'INSERT INTO product_components(parent_product_id,sequence_no,brand,name,type,category,quantity,volume_ml,volume_text,gender,raw_component,needs_review,review_reasons_json) VALUES('+','.join(['%s']*13)+')',comp_values)
                defects=[]
                for p in products:
                    for defect in p.get('defects') or []:
                        code=defect.get('code') if isinstance(defect,dict) else str(defect)
                        if code: defects.append((product_map[p['id']],str(code)[:40]))
                if defects:
                    await cur.executemany('INSERT IGNORE INTO product_defects(product_id,defect_code) VALUES(%s,%s)',defects)
                await cur.execute("UPDATE price_lists SET status='ready' WHERE id=%s",(price_list_id,))
                await conn.commit()
            except Exception:
                await conn.rollback()
                raise
    return {'products':len(products),'components':len(components),'review':sum(int(p.get('needs_review') or 0) for p in products),'sets':sum(int(p.get('is_set') or 0) for p in products)}

async def persist_parsed_file(tg_id: int, filename: str, file_path: Path, size_bytes: int, data: dict[str,Any], price_list_id: int):
    # InnoDB deadlocks are transient. Retry the entire transaction only after rollback.
    # Parsing stays concurrent; serialize the large write phase to avoid the files
    # deadlocking each other on the shared FK/indexes. Retry remains for other writers.
    async with _db_write_lock:
        for attempt in range(4):
            try:
                return await _persist_parsed_file_once(tg_id, filename, file_path, size_bytes, data, price_list_id)
            except Exception as exc:
                errno = exc.args[0] if getattr(exc, 'args', None) else None
                if errno not in (1213, 1205) or attempt >= 3:
                    raise
                await asyncio.sleep((0.25 * (2 ** attempt)) + random.uniform(0.05, 0.3))
                log.warning('Retrying price-list DB transaction after MySQL lock error %s (attempt %s/4)', errno, attempt + 2)



async def process_web_uploaded_price_file(
    tg_id: int, filename: str, file_path: Path, size_bytes: int, price_list_id: int
) -> dict[str, Any]:
    """Parse and persist an already-created website price_lists row.

    The parser engine and persistence transaction are the same implementation used
    by the Telegram application. This entry point deliberately does not start or
    call Telegram services.
    """
    from database.connection import pool

    try:
        if not file_path.is_file():
            raise FileNotFoundError(f"Загруженный файл не найден: {file_path.name}")
        data = await asyncio.to_thread(_load_engine_and_parse, file_path, filename)
        stats = await persist_parsed_file(tg_id, filename, file_path, size_bytes, data, price_list_id)
        return {"ok": True, "filename": filename, "stats": stats}
    except Exception as exc:
        log.exception("Failed to process website upload %s for tg_id=%s", filename, tg_id)
        try:
            async with pool().acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute("UPDATE price_lists SET status='error' WHERE id=%s", (int(price_list_id),))
                    await cur.execute(
                        "INSERT INTO parse_errors(tg_id,file_id,error_code,details) VALUES(%s,%s,%s,%s)",
                        (int(tg_id), int(price_list_id), "file_parse_error", str(exc)[:2000]),
                    )
                await conn.commit()
        except Exception:
            log.exception("Could not store website parse error for price_list_id=%s", price_list_id)
        return {"ok": False, "filename": filename, "technical_error": str(exc)}
