"""Website upload conflict scanner, ported from the Telegram bot's file_names/conflict_scan logic.

It is deliberately read-only: it fingerprints staged files and existing user files,
then stores a review manifest. It never writes catalogue rows or changes existing files.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import csv
import re
from datetime import date, datetime, time
from difflib import SequenceMatcher
from pathlib import Path
from xml.etree import ElementTree

from config import settings
from database.connection import pool

log = logging.getLogger(__name__)
_PREFIX_TIMESTAMP = re.compile(r"^\d{8}_\d{6}_(?:\d{6}_)?(?:[0-9a-fA-F]{4}_)?")
_SUFFIX_TIMESTAMP = re.compile(r"_\d{8}_\d{6}(?:_\d{6})?$")
_MARKER = re.compile(r"(?:PRICE[ _-]*LIST|PRICELIST|ПРАЙС[ _-]*ЛИСТ)", re.I | re.U)
_DUPLICATE_SUFFIX = re.compile(r"(?i)(\.(?:xlsx|xlsm|xls|csv|tsv|txt))\s*\(\d+\)$")
_EUROPEAN_DATE_SUFFIX = re.compile(r"(?:[ _-]+)(?:0?[1-9]|[12]\d|3[01])[._-](?:0?[1-9]|1[0-2])[._-](?:19|20)\d{2}$", re.I)


def normalize_filename(filename: str | None) -> str:
    name = Path(str(filename or "")).name.strip()
    name = re.sub(r"(?i)\s+\(\d+\)(?=\.(?:xlsx|xlsm|xls|csv|tsv|txt)$)", "", name)
    name = _DUPLICATE_SUFFIX.sub(r"\1", name)
    suffix = Path(name).suffix.casefold()
    stem = name[:-len(Path(name).suffix)] if Path(name).suffix else name
    stem = _PREFIX_TIMESTAMP.sub("", stem, count=1)
    marker = _MARKER.search(stem)
    if marker:
        stem = stem[marker.start():]
        marker_at_start = _MARKER.match(stem)
        if marker_at_start:
            stem = stem[marker_at_start.end():]
    stem = _SUFFIX_TIMESTAMP.sub("", stem, count=1)
    stem = re.sub(r"(?:[_-](?:19|20)\d{2}[._-]?\d{2}[._-]?\d{2}){1,2}$", "", stem, flags=re.I)
    stem = _EUROPEAN_DATE_SUFFIX.sub("", stem)
    stem = re.sub(r"(?:[_-](?:\d{2,14}|x{1,4})[_-](?:\d{2,14}|x{4,8}))+$", "", stem, flags=re.I)
    stem = re.sub(r"[_ -]+", "_", stem).strip("_ -").casefold()
    return stem + suffix


def filename_similarity(left: str | None, right: str | None) -> float:
    a, b = normalize_filename(left), normalize_filename(right)
    if not a or not b or Path(a).suffix.casefold() != Path(b).suffix.casefold():
        return 0.0
    a_stem, b_stem = Path(a).stem, Path(b).stem
    if a_stem == b_stem:
        return 1.0
    if min(len(a_stem), len(b_stem)) < 12:
        return 0.0
    return SequenceMatcher(None, a_stem, b_stem).ratio()


def file_content_sha256(path: str | Path, progress=None, start: float = 0.0, end: float = 100.0) -> str | None:
    digest = hashlib.sha256()
    try:
        file_path = Path(path)
        total = max(1, file_path.stat().st_size)
        done = 0
        with file_path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
                done += len(chunk)
                if progress:
                    progress(start + (end - start) * min(1.0, done / total))
    except (OSError, ValueError):
        return None
    if progress:
        progress(end)
    return digest.hexdigest()


def _stable_value(value):
    if isinstance(value, (datetime, date, time)):
        return {"type": type(value).__name__, "value": value.isoformat()}
    if isinstance(value, (str, int, float, bool)) or value is None:
        return {"type": type(value).__name__, "value": value}
    return {"type": type(value).__name__, "value": str(value)}


def _xml_signature(style_object) -> str:
    try:
        return ElementTree.tostring(style_object.to_tree(), encoding="unicode")
    except Exception:
        return str(style_object)


def workbook_semantic_sha256(path: str | Path, progress=None, start: float = 0.0, end: float = 100.0) -> str | None:
    file_path = Path(path)
    if file_path.suffix.casefold() not in {".xlsx", ".xlsm"}:
        return None
    try:
        from openpyxl import load_workbook
        workbook = load_workbook(file_path, read_only=False, data_only=False, keep_links=True)
        payload = []
        try:
            worksheets = list(workbook.worksheets)
            total_cells = max(1, sum(len(ws._cells) for ws in worksheets))
            processed_cells = 0
            for worksheet in worksheets:
                cells = []
                for cell in sorted(worksheet._cells.values(), key=lambda item: (item.row, item.column)):
                    cells.append([
                        cell.row, cell.column, _stable_value(cell.value), cell.data_type,
                        _xml_signature(cell.font), _xml_signature(cell.fill),
                        _xml_signature(cell.border), _xml_signature(cell.alignment),
                        _xml_signature(cell.protection), cell.number_format,
                    ])
                    processed_cells += 1
                    if progress and (processed_cells % 100 == 0 or processed_cells == total_cells):
                        progress(start + (end - start) * processed_cells / total_cells)
                row_dims = sorted((int(index), float(dim.height) if dim.height is not None else None, bool(dim.hidden), int(dim.outlineLevel or 0))
                                  for index, dim in worksheet.row_dimensions.items()
                                  if dim.height is not None or dim.hidden or dim.outlineLevel)
                col_dims = sorted((str(index), float(dim.width) if dim.width is not None else None, bool(dim.hidden), int(dim.outlineLevel or 0))
                                  for index, dim in worksheet.column_dimensions.items()
                                  if dim.width is not None or dim.hidden or dim.outlineLevel)
                payload.append({
                    "title": worksheet.title, "state": worksheet.sheet_state,
                    "cells": cells, "merged": sorted(str(rng) for rng in worksheet.merged_cells.ranges),
                    "rows": row_dims, "columns": col_dims,
                    "freeze_panes": str(worksheet.freeze_panes or ""),
                    "sheet_format": [worksheet.sheet_format.defaultRowHeight, worksheet.sheet_format.defaultColWidth],
                })
        finally:
            workbook.close()
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        if progress:
            progress(end)
        return hashlib.sha256(encoded).hexdigest()
    except Exception:
        log.exception("Could not compute semantic Excel fingerprint for %s", file_path.name)
        return None


def _preview_row_count(path: Path, filename: str) -> int | None:
    try:
        from services.parser.price_list import _load_engine_and_parse
        parsed = _load_engine_and_parse(path, filename)
        return len(parsed.get("source_rows") or [])
    except Exception:
        log.info("Canonical parser preview was unavailable for %s; counting non-empty source rows", filename, exc_info=True)
    suffix = path.suffix.casefold()
    try:
        if suffix in {".xlsx", ".xlsm"}:
            from openpyxl import load_workbook
            workbook = load_workbook(path, read_only=True, data_only=False)
            try:
                return sum(1 for sheet in workbook.worksheets for row in sheet.iter_rows(values_only=True)
                           if any(value is not None and str(value).strip() for value in row))
            finally:
                workbook.close()
        if suffix == ".xls":
            import xlrd
            workbook = xlrd.open_workbook(str(path), on_demand=True)
            try:
                return sum(1 for sheet in workbook.sheets() for row_index in range(sheet.nrows)
                           if any(value not in (None, "") for value in sheet.row_values(row_index)))
            finally:
                workbook.release_resources()
        if suffix == ".csv":
            for encoding in ("utf-8-sig", "cp1251", "latin-1"):
                try:
                    with path.open("r", encoding=encoding, newline="") as stream:
                        return sum(1 for row in csv.reader(stream) if any(str(value).strip() for value in row))
                except UnicodeDecodeError:
                    continue
    except Exception:
        log.exception("Could not count preview rows for %s", filename)
    return None


def _fingerprint(path: Path, filename: str, progress=None, start: float = 0.0, end: float = 100.0) -> dict:
    size = path.stat().st_size
    digest_end = start + (end - start) * 0.35
    digest = file_content_sha256(path, progress, start, digest_end)
    semantic = workbook_semantic_sha256(path, progress, digest_end, end)
    if progress:
        progress(end)
    return {
        "path": path,
        "filename": Path(filename).name,
        "norm": normalize_filename(filename),
        "size": size,
        "digest": digest,
        "semantic_digest": semantic,
    }


def _compare(existing: dict, candidate: dict) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    if existing["norm"] and existing["norm"] == candidate["norm"]:
        reasons.append("name")
    elif filename_similarity(existing["filename"], candidate["filename"]) >= 0.93:
        reasons.append("name")
    if (existing.get("digest") and candidate.get("digest")
            and existing["size"] == candidate["size"]
            and existing["digest"] == candidate["digest"]):
        reasons.append("content")
    if (existing.get("semantic_digest") and candidate.get("semantic_digest")
            and existing["semantic_digest"] == candidate["semantic_digest"]):
        reasons.append("formatting")
    return bool(reasons), reasons


async def scan_upload_batch(tg_id: int, manifest: dict, progress=None) -> dict:
    """Read-only duplicate scan with measurable, monotonic progress callbacks (0..100)."""
    def report(value: float) -> None:
        if progress:
            progress(max(0.0, min(100.0, float(value))))

    root = settings.upload_storage_dir.resolve()
    user_root = (root / str(int(tg_id))).resolve()
    if not user_root.is_relative_to(root):
        raise RuntimeError("Unsafe upload user directory")

    items = list(manifest.get("files", []))
    candidates = []
    candidate_paths: set[Path] = set()
    report(0)
    for index, item in enumerate(items):
        raw = Path(str(item.get("path") or ""))
        path = raw.resolve(strict=True)
        if not path.is_file() or not path.is_relative_to(user_root):
            raise RuntimeError("Staged upload path is outside the user's private directory")
        candidate_paths.add(path)
        lo, hi = 2 + 10 * index / max(1, len(items)), 2 + 10 * (index + 1) / max(1, len(items))
        candidates.append(_fingerprint(path, str(item.get("filename") or path.name), report, lo, hi))
    if not candidates:
        report(100)
        return {"files": []}

    existing: list[dict] = []
    async with pool().acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id,filename,filepath,size_bytes FROM price_lists WHERE owner_tg_id=%s",
                (int(tg_id),),
            )
            rows = await cur.fetchall()
    seen_paths: set[Path] = set()
    for row_id, filename, filepath, size_bytes in rows:
        path = None
        if filepath:
            try:
                resolved = Path(str(filepath)).resolve(strict=True)
                if resolved.is_file() and resolved.is_relative_to(root):
                    path = resolved
            except (OSError, ValueError):
                path = None
        record = {"id": int(row_id), "filename": Path(str(filename or "")).name,
                  "path": str(path) if path else None, "size": int(size_bytes or 0),
                  "norm": normalize_filename(str(filename or "")),
                  "digest": None, "semantic_digest": None}
        if path:
            record["size"] = path.stat().st_size
            seen_paths.add(path)
        existing.append(record)

    if user_root.is_dir():
        for path in user_root.rglob("*"):
            try:
                resolved = path.resolve(strict=True)
                if not path.is_file() or not resolved.is_relative_to(user_root) or resolved in candidate_paths or resolved in seen_paths:
                    continue
                if ".web-upload-staging" in resolved.parts:
                    continue
                existing.append({"id": None, "filename": path.name, "path": str(resolved),
                                 "size": resolved.stat().st_size, "norm": normalize_filename(path.name),
                                 "digest": None, "semantic_digest": None})
                seen_paths.add(resolved)
            except (OSError, ValueError):
                log.debug("Could not inspect existing user upload %s", path, exc_info=True)

    # 12..82% is real work: content hashes and workbook structure/style inspection.
    digest_cache: dict[Path, str | None] = {}
    semantic_cache: dict[Path, str | None] = {}
    work = []
    for old in existing:
        raw_path = old.get("path")
        if not raw_path:
            continue
        old_path = Path(raw_path)
        suffix = old_path.suffix.casefold()
        needs_digest = any(candidate["size"] == old["size"] and candidate.get("digest") for candidate in candidates)
        needs_semantic = suffix in {".xlsx", ".xlsm"} and any(Path(candidate["filename"]).suffix.casefold() == suffix and candidate.get("semantic_digest") for candidate in candidates)
        if needs_digest or needs_semantic:
            work.append((old, old_path, needs_digest, needs_semantic))
    total_parts = sum(int(d) + int(sm) for _, _, d, sm in work) or 1
    done_parts = 0
    for old, old_path, needs_digest, needs_semantic in work:
        if needs_digest:
            lo, hi = 12 + 70 * done_parts / total_parts, 12 + 70 * (done_parts + 1) / total_parts
            digest_cache[old_path] = file_content_sha256(old_path, report, lo, hi)
            old["digest"] = digest_cache[old_path]
            done_parts += 1
        if needs_semantic:
            lo, hi = 12 + 70 * done_parts / total_parts, 12 + 70 * (done_parts + 1) / total_parts
            semantic_cache[old_path] = workbook_semantic_sha256(old_path, report, lo, hi)
            old["semantic_digest"] = semantic_cache[old_path]
            done_parts += 1
    if not work:
        report(82)

    results = []
    total_pairs = max(1, len(candidates) * max(1, len(existing)))
    checked_pairs = 0
    for item, candidate in zip(items, candidates):
        old_ids: set[int] = set()
        old_paths: set[str] = set()
        reasons: set[str] = set()
        old_names: list[str] = []
        for old in existing:
            matched, match_reasons = _compare(old, candidate)
            if matched:
                reasons.update(match_reasons)
                if old.get("id") is not None:
                    old_ids.add(int(old["id"]))
                if old.get("path"):
                    old_paths.add(str(old["path"]))
                if old.get("filename") and old["filename"] not in old_names:
                    old_names.append(old["filename"])
            checked_pairs += 1
            if checked_pairs % 10 == 0 or checked_pairs == total_pairs:
                report(82 + 13 * checked_pairs / total_pairs)
        row_count = await asyncio.to_thread(_preview_row_count, candidate["path"], candidate["filename"])
        results.append({
            "token": str(item["token"]), "filename": candidate["filename"],
            "size_bytes": candidate["size"], "row_count": row_count,
            "conflict": bool(reasons), "match_reasons": sorted(reasons),
            "existing_names": old_names[:8], "existing_ids": sorted(old_ids),
            "existing_paths": sorted(old_paths),
        })
    report(100)
    return {"files": results}
