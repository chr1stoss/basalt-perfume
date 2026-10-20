"""Filename normalization and content fingerprints for duplicate upload detection."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, time
from difflib import SequenceMatcher
from xml.etree import ElementTree
from pathlib import Path

_PREFIX_TIMESTAMP = re.compile(r"^\d{8}_\d{6}_(?:\d{6}_)?(?:[0-9a-fA-F]{4}_)?")
_SUFFIX_TIMESTAMP = re.compile(r"_\d{8}_\d{6}(?:_\d{6})?$")
_MARKER = re.compile(r"(?:PRICE[ _-]*LIST|PRICELIST|ПРАЙС[ _-]*ЛИСТ)", re.I | re.U)
_DUPLICATE_SUFFIX = re.compile(r"(?i)(\.(?:xlsx|xlsm|xls|csv|tsv|txt))\s*\(\d+\)$")
_EUROPEAN_DATE_SUFFIX = re.compile(r"(?:[ _-]+)(?:0?[1-9]|[12]\d|3[01])[._-](?:0?[1-9]|1[0-2])[._-](?:19|20)\d{2}$", re.I)


def normalize_filename(filename: str | None) -> str:
    """Return a stable, case-insensitive filename key.

    Strips the common Windows duplicate suffix after the extension (e.g. ``.xlsx (1)``),
    known generated timestamp wrappers, and trailing dates such as ``20.07.2026``.
    The actual stored filename is never changed by this function.
    """
    name = Path(str(filename or "")).name.strip()
    # Windows/browser copies may append (1) either after the extension
    # ('.xlsx (1)') or immediately before it (' (1).xlsx').
    name = re.sub(r"(?i)\s+\(\d+\)(?=\.(?:xlsx|xlsm|xls|csv|tsv|txt)$)", "", name)
    # In the after-extension case Path.suffix would otherwise become '.xlsx (1)'.
    name = _DUPLICATE_SUFFIX.sub(r"\1", name)
    suffix = Path(name).suffix.casefold()
    stem = name[:-len(Path(name).suffix)] if Path(name).suffix else name
    stem = _PREFIX_TIMESTAMP.sub("", stem, count=1)
    marker = _MARKER.search(stem)
    if marker and marker.start() > 0:
        stem = stem[marker.start():]
    stem = _SUFFIX_TIMESTAMP.sub("", stem, count=1)
    stem = re.sub(r"(?:[_-](?:19|20)\d{2}[._-]?\d{2}[._-]?\d{2}){1,2}$", "", stem, flags=re.I)
    stem = _EUROPEAN_DATE_SUFFIX.sub("", stem)
    # Legacy generated wrappers can contain masked timestamp chunks such as xx_xxxx.
    stem = re.sub(r"(?:[_-](?:\d{2,14}|[a-z]{1,4})[_-](?:\d{2,14}|[a-z]{1,8}))+$", "", stem, flags=re.I)
    stem = re.sub(r"[_ -]+", "_", stem).strip("_ -").casefold()
    return stem + suffix


def file_content_sha256(path: str | Path) -> str | None:
    """Return the SHA-256 digest of a file, or None when it cannot be read."""
    file_path = Path(path)
    digest = hashlib.sha256()
    try:
        with file_path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except (OSError, ValueError):
        return None
    return digest.hexdigest()


def filename_similarity(left: str | None, right: str | None) -> float:
    """Compare normalized filename stems without treating short names as duplicates."""
    a = normalize_filename(left)
    b = normalize_filename(right)
    if not a or not b or Path(a).suffix.casefold() != Path(b).suffix.casefold():
        return 0.0
    a_stem = Path(a).stem
    b_stem = Path(b).stem
    if a_stem == b_stem:
        return 1.0
    if min(len(a_stem), len(b_stem)) < 12:
        return 0.0
    return SequenceMatcher(None, a_stem, b_stem).ratio()


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


def workbook_semantic_sha256(path: str | Path) -> str | None:
    """Fingerprint workbook data and cell formatting, ignoring XLSX ZIP metadata.

    This detects a workbook copied/re-saved by Excel where cell data and styles are
    identical but ZIP timestamps, relationship IDs, or package metadata changed.
    Only OOXML workbooks are handled here; other formats fall back to byte hashing.
    """
    file_path = Path(path)
    if file_path.suffix.casefold() not in {".xlsx", ".xlsm"}:
        return None
    try:
        from openpyxl import load_workbook

        workbook = load_workbook(file_path, read_only=False, data_only=False, keep_links=True)
        payload = []
        try:
            for worksheet in workbook.worksheets:
                cells = []
                for cell in sorted(worksheet._cells.values(), key=lambda item: (item.row, item.column)):
                    cells.append([
                        cell.row, cell.column, _stable_value(cell.value), cell.data_type,
                        _xml_signature(cell.font), _xml_signature(cell.fill),
                        _xml_signature(cell.border), _xml_signature(cell.alignment),
                        _xml_signature(cell.protection), cell.number_format,
                    ])
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
        return hashlib.sha256(encoded).hexdigest()
    except Exception:
        # A malformed/unsupported workbook should not make uploads fail. The caller
        # can still use filename and raw-byte fingerprints.
        return None
