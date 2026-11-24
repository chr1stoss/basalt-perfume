#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Universal perfume/cosmetics price-list normalizer -> MariaDB SQL dump or DB.

Reads XLS/XLSX/CSV/TSV; stores EVERY physical row in source_rows, creates one product
per commercial line, and stores explicitly parsed set children in product_components.
Ambiguous cases are marked for review; raw titles/cells are never discarded.

Examples:
  python sort_import.py ./price_lists --out-sql perfume_catalog.sql
  python sort_import.py file.xls file.xlsx --out-sql perfume_catalog.sql
  python sort_import.py ./price_lists --mysql-host 127.0.0.1 --mysql-user root --mysql-database perfume_catalog

Dependencies for XLSX: openpyxl. Optional direct MariaDB insert: PyMySQL.
For legacy XLS, xlrd is used when present; otherwise a compact BIFF/OLE reader handles
ordinary BIFF8 cells. Raw values that look corrupted are preserved and flagged, never guessed.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import shutil
import subprocess
import struct
import sys
import tempfile
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

PARSER_VERSION = "2.2.1"

# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------
def is_empty(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not v.strip()) or (isinstance(v, float) and math.isnan(v))


def json_safe(v: Any) -> Any:
    if is_empty(v):
        return None
    if isinstance(v, (str, int, float, bool)):
        if isinstance(v, float) and not math.isfinite(v):
            return str(v)
        return v
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v)


def normalize_text(s: Any) -> str:
    s = unicodedata.normalize("NFKC", str(s or "")).replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


DISPLAY_SIZE_RE = re.compile(
    r"(?<![\w.])(?P<w>\d+(?:[.,]\d+)?)\s*(?P<u1>mm|мм|cm|см|m|м)?\s*(?:[xх×*])\s*"
    r"(?P<h>\d+(?:[.,]\d+)?)\s*(?P<u2>mm|мм|cm|см|m|м)?(?![\w])", re.I | re.U
)


def _dimension_unit(value: Any) -> Optional[str]:
    unit = normalize_text(value or "").casefold().replace("ё", "е")
    if not unit:
        return None
    if unit in ("mm", "мм"):
        return "mm"
    if unit in ("cm", "см"):
        return "cm"
    if unit in ("m", "м"):
        return "m"
    return None


def _dimension_to(value: Any, source_unit: Optional[str], target_unit: str) -> Optional[float]:
    try:
        number = float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return None
    unit = source_unit or target_unit
    if unit == target_unit:
        result = number
    elif unit == "m" and target_unit == "cm":
        result = number * 100
    elif unit == "m" and target_unit == "mm":
        result = number * 1000
    elif unit == "cm" and target_unit == "mm":
        result = number * 10
    elif unit == "mm" and target_unit == "cm":
        result = number / 10
    else:
        result = number
    return round(result, 3) if math.isfinite(result) and result > 0 else None


def extract_display_dimensions(text: Any, width_column: Any = None, height_column: Any = None) -> dict[str, Any]:
    """Parse W×H for displays. Unlabelled fractional dimensions below 10 imply meters; otherwise default to centimeters."""
    raw = normalize_text(text or "")
    match = DISPLAY_SIZE_RE.search(raw)
    if match:
        unit1 = _dimension_unit(match.group("u1"))
        unit2 = _dimension_unit(match.group("u2"))
        explicit_units = [u for u in (unit1, unit2) if u]
        # Keep millimeters if explicitly named; otherwise normalize meters to centimeters.
        target = "mm" if "mm" in explicit_units else "cm"
        if not explicit_units:
            raw_w = match.group("w").replace(",", ".")
            raw_h = match.group("h").replace(",", ".")
            try:
                numeric_w, numeric_h = float(raw_w), float(raw_h)
            except ValueError:
                numeric_w, numeric_h = 0.0, 0.0
            # Catalog rows often write small fractional display dimensions as 0.4x0.6
            # meaning 0.4m × 0.6m. Integer pairs such as 60x80 keep the cm default.
            if ("." in raw_w or "." in raw_h) and 0 < numeric_w <= 10 and 0 < numeric_h <= 10:
                unit1 = unit2 = "m"
        u1 = unit1 or unit2 or target
        u2 = unit2 or unit1 or target
        width = _dimension_to(match.group("w"), u1, target)
        height = _dimension_to(match.group("h"), u2, target)
        if width and height:
            return {"size_width": width, "size_height": height, "size_unit": target, "raw": match.group(0)}
    if width_column is not None and height_column is not None and not is_empty(width_column) and not is_empty(height_column):
        unit_match = re.search(r"(?i)\b(mm|мм|cm|см|m|м)\b", raw)
        source_unit = _dimension_unit(unit_match.group(1)) if unit_match else None
        target = "mm" if source_unit == "mm" else "cm"
        width = _dimension_to(width_column, source_unit or target, target)
        height = _dimension_to(height_column, source_unit or target, target)
        if width and height:
            return {"size_width": width, "size_height": height, "size_unit": target, "raw": f"{width_column} x {height_column}"}
    return {"size_width": None, "size_height": None, "size_unit": None, "raw": None}


def normalize_brand(s: Any) -> str:
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).casefold()
    s = s.replace("&", " and ").replace("+", " and ")
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    return re.sub(r"\s+", " ", s).strip()


def to_text(v: Any) -> Optional[str]:
    if is_empty(v):
        return None
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return normalize_text(v)


def parse_price(v: Any) -> Optional[float]:
    if is_empty(v):
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        x = float(v)
        return x if math.isfinite(x) else None
    s = str(v).strip()
    if not s:
        return None
    s = re.sub(r"(?i)(usd|eur|rub|rur|uah|руб\.?|грн|у\.е\.|\$|€|₽)", "", s).strip()
    s = s.replace("\xa0", "").replace(" ", "")
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        tail = s.rsplit(",", 1)[-1]
        s = s.replace(",", ".") if len(tail) <= 2 else s.replace(",", "")
    try:
        x = float(s)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def sql_quote(v: Any) -> str:
    """Quote a scalar for MariaDB SQL. Use only for generated local dump values."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if isinstance(v, float) and not math.isfinite(v):
            return "NULL"
        return str(v)
    s = str(v)
    s = s.replace("\\", "\\\\").replace("\x00", "\\0").replace("\n", "\\n").replace("\r", "\\r").replace("\x1a", "\\Z").replace("'", "\\'")
    return "'" + s + "'"

# ---------------------------------------------------------------------------
# Legacy XLS (BIFF8/OLE) read fallback. xlrd is used first when installed.
# ---------------------------------------------------------------------------
_FREESECT = 0xFFFFFFFF
_ENDOFCHAIN = 0xFFFFFFFE


def _xls_workbook_stream(path: Path) -> bytes:
    data = path.read_bytes()
    if data[:8] != bytes.fromhex("D0CF11E0A1B11AE1"):
        raise ValueError(f"{path.name}: это не OLE/BIFF .xls")
    sec_size = 1 << struct.unpack_from("<H", data, 0x1E)[0]
    mini_sec_size = 1 << struct.unpack_from("<H", data, 0x20)[0]
    nfat = struct.unpack_from("<I", data, 0x2C)[0]
    first_dir = struct.unpack_from("<I", data, 0x30)[0]
    mini_cutoff = struct.unpack_from("<I", data, 0x38)[0]
    first_minifat = struct.unpack_from("<I", data, 0x3C)[0]
    n_minifat = struct.unpack_from("<I", data, 0x40)[0]
    first_difat = struct.unpack_from("<I", data, 0x44)[0]
    n_difat = struct.unpack_from("<I", data, 0x48)[0]

    def sector(sid: int) -> bytes:
        return data[(sid + 1) * sec_size:(sid + 2) * sec_size]

    difat = [x for x in struct.unpack_from("<109I", data, 0x4C) if x not in (_FREESECT, _ENDOFCHAIN)]
    sid = first_difat
    for _ in range(n_difat):
        if sid in (_FREESECT, _ENDOFCHAIN):
            break
        words = struct.unpack("<" + "I" * (sec_size // 4), sector(sid))
        difat.extend(x for x in words[:-1] if x not in (_FREESECT, _ENDOFCHAIN))
        sid = words[-1]
    fat: list[int] = []
    for fsid in difat[:nfat]:
        fat.extend(struct.unpack("<" + "I" * (sec_size // 4), sector(fsid)))

    def chain(start: int, table: list[int]) -> list[int]:
        result, seen, cur = [], set(), start
        while cur not in (_FREESECT, _ENDOFCHAIN) and cur < len(table) and cur not in seen:
            result.append(cur); seen.add(cur); cur = table[cur]
        return result

    def read_regular(start: int, table: list[int] = fat) -> bytes:
        return b"".join(sector(s) for s in chain(start, table))

    directory = read_regular(first_dir)
    entries = []
    for off in range(0, len(directory), 128):
        ent = directory[off:off + 128]
        if len(ent) != 128:
            continue
        name_len = struct.unpack_from("<H", ent, 64)[0]
        name = ent[:max(0, name_len - 2)].decode("utf-16le", "ignore") if name_len >= 2 else ""
        typ = ent[66]
        start = struct.unpack_from("<I", ent, 116)[0]
        size = struct.unpack_from("<Q", ent, 120)[0]
        entries.append((name, typ, start, size))

    for name, typ, start, size in entries:
        if typ != 2 or name.lower() not in ("workbook", "book"):
            continue
        if size >= mini_cutoff:
            return read_regular(start)[:size]
        root = entries[0]
        mini_store = read_regular(root[2])[:root[3]]
        minifat_raw = read_regular(first_minifat)[:n_minifat * sec_size] if n_minifat else b""
        mini_fat = list(struct.unpack("<" + "I" * (len(minifat_raw) // 4), minifat_raw)) if minifat_raw else []
        return b"".join(mini_store[s * mini_sec_size:(s + 1) * mini_sec_size] for s in chain(start, mini_fat))[:size]
    raise ValueError(f"{path.name}: Workbook stream не найден")


def _xls_records(path: Path) -> list[tuple[int, int, int, bytes]]:
    stream = _xls_workbook_stream(path)
    result = []
    off = 0
    while off + 4 <= len(stream):
        rec_id, length = struct.unpack_from("<HH", stream, off)
        payload = stream[off + 4:off + 4 + length]
        if len(payload) < length:
            break
        result.append((off, rec_id, length, payload))
        off += 4 + length
    return result


class _SSTCursor:
    def __init__(self, segments: list[bytes]):
        self.segments, self.si, self.pos = segments, 0, 0

    def _advance(self) -> None:
        while self.si < len(self.segments) and self.pos >= len(self.segments[self.si]):
            self.si += 1; self.pos = 0

    def read(self, n: int) -> bytes:
        out = bytearray()
        while len(out) < n:
            self._advance()
            if self.si >= len(self.segments):
                raise EOFError("SST underrun")
            take = min(n - len(out), len(self.segments[self.si]) - self.pos)
            out.extend(self.segments[self.si][self.pos:self.pos + take]); self.pos += take
        return bytes(out)

    def u8(self) -> int: return self.read(1)[0]
    def u16(self) -> int: return struct.unpack("<H", self.read(2))[0]
    def u32(self) -> int: return struct.unpack("<I", self.read(4))[0]

    def chars(self, count: int, wide: bool) -> str:
        pieces, remaining, wide = [], count, bool(wide)
        while remaining:
            self._advance()
            if self.si >= len(self.segments):
                raise EOFError("SST char underrun")
            avail = len(self.segments[self.si]) - self.pos
            step = 2 if wide else 1
            units = avail // step
            if units <= 0:
                self.pos = len(self.segments[self.si]); continue
            take = min(remaining, units)
            b = self.read(take * step)
            pieces.append(b.decode("utf-16le" if wide else "latin1", "replace"))
            remaining -= take
            self._advance()
            if remaining and self.si < len(self.segments) and self.pos == 0:
                # CONTINUE starts with a new encoding flag only when character data continues.
                cont_flags = self.u8()
                wide = bool(cont_flags & 1)
        return "".join(pieces)

    def skip(self, n: int) -> None:
        while n:
            self._advance()
            if self.si >= len(self.segments):
                raise EOFError("SST skip underrun")
            take = min(n, len(self.segments[self.si]) - self.pos)
            self.pos += take; n -= take


def _xls_sst(records: list[tuple[int, int, int, bytes]]) -> list[str]:
    idx = next((i for i, r in enumerate(records) if r[1] == 0x00FC), None)
    if idx is None:
        return []
    segments = [records[idx][3]]
    j = idx + 1
    while j < len(records) and records[j][1] == 0x003C:
        segments.append(records[j][3]); j += 1
    c = _SSTCursor(segments)
    _total, unique = c.u32(), c.u32()
    result: list[str] = []
    for _ in range(unique):
        cch, flags = c.u16(), c.u8()
        rich, extended = bool(flags & 0x08), bool(flags & 0x04)
        run_count = c.u16() if rich else 0
        ext_size = c.u32() if extended else 0
        value = c.chars(cch, bool(flags & 1))
        if run_count:
            c.skip(run_count * 4)
        if ext_size:
            c.skip(ext_size)
        result.append(value)
    return result


def _rk_value(rk: int) -> float:
    divide100 = bool(rk & 0x02)
    if rk & 0x01:
        value = rk >> 2
        if value & (1 << 29):
            value -= 1 << 30
        n = float(value)
    else:
        n = struct.unpack("<d", struct.pack("<II", 0, rk & 0xFFFFFFFC))[0]
    return n / 100 if divide100 else n


def _xls_biff_rows(path: Path) -> list[tuple[str, list[list[Any]]]]:
    records = _xls_records(path)
    sst = _xls_sst(records)
    bounds = []
    for off, rec_id, _length, payload in records:
        if rec_id == 0x0085 and len(payload) >= 8:
            sheet_offset = struct.unpack_from("<I", payload, 0)[0]
            name_len, flags = payload[6], payload[7]
            nm = payload[8:8 + name_len * (2 if flags & 1 else 1)].decode("utf-16le" if flags & 1 else "latin1", "replace")
            bounds.append((sheet_offset, nm))
    workbook_len = len(_xls_workbook_stream(path))
    sheets: list[tuple[str, list[list[Any]]]] = []
    for i, (start, name) in enumerate(bounds):
        end = bounds[i + 1][0] if i + 1 < len(bounds) else workbook_len
        cells: dict[tuple[int, int], Any] = {}
        max_row = max_col = -1
        for off, rec_id, length, payload in records:
            if off < start or off >= end:
                continue
            try:
                if rec_id == 0x00FD:  # LABELSST
                    row, col, _xf, sst_idx = struct.unpack_from("<HHHI", payload, 0)
                    value = sst[sst_idx] if sst_idx < len(sst) else None
                elif rec_id == 0x0203:  # NUMBER
                    row, col, _xf = struct.unpack_from("<HHH", payload, 0)
                    value = struct.unpack_from("<d", payload, 6)[0]
                elif rec_id == 0x027E:  # RK
                    row, col, _xf, rk = struct.unpack_from("<HHHI", payload, 0)
                    value = _rk_value(rk)
                    # A known writer defect in some MyXls exports: numeric article codes
                    # are emitted as tiny subnormal floats. Recover the shifted code only
                    # for the first column; preserve other values unmodified.
                    if col == 0 and isinstance(value, float) and 0 < abs(value) < 1e-290:
                        raw_bits = struct.unpack("<Q", struct.pack("<d", value))[0]
                        rk_raw = (raw_bits >> 32) & 0xFFFFFFFF
                        value = str(rk_raw >> 2)
                elif rec_id == 0x00BD:  # MULRK
                    row, first_col = struct.unpack_from("<HH", payload, 0)
                    last_col = struct.unpack_from("<H", payload, length - 2)[0]
                    p = 4
                    for col in range(first_col, last_col + 1):
                        _xf, rk = struct.unpack_from("<HI", payload, p); p += 6
                        value = _rk_value(rk)
                        cells[(row, col)] = value
                        max_row, max_col = max(max_row, row), max(max_col, col)
                    continue
                elif rec_id == 0x0204:  # LABEL (older BIFF)
                    row, col, _xf, cch = struct.unpack_from("<HHHH", payload, 0)
                    flags = payload[8] if len(payload) > 8 else 0
                    width = 2 if flags & 1 else 1
                    value = payload[9:9 + cch * width].decode("utf-16le" if width == 2 else "cp1252", "replace")
                elif rec_id == 0x0006:  # FORMULA cached numeric result
                    row, col, _xf = struct.unpack_from("<HHH", payload, 0)
                    # Formula result cache can be a special non-numeric marker.
                    result = payload[6:14]
                    if len(result) == 8 and result[6:8] != b"\xff\xff":
                        value = struct.unpack("<d", result)[0]
                    else:
                        continue
                elif rec_id == 0x0205:  # BOOLERR
                    row, col, _xf = struct.unpack_from("<HHH", payload, 0)
                    value = payload[6] if len(payload) >= 8 and payload[7] == 0 else None
                else:
                    continue
                cells[(row, col)] = value
                max_row, max_col = max(max_row, row), max(max_col, col)
            except (IndexError, struct.error, ValueError):
                continue
        matrix = [[cells.get((r, c)) for c in range(max_col + 1)] for r in range(max_row + 1)]
        sheets.append((name, matrix))
    return sheets


def _read_xls_via_libreoffice(path: Path) -> Optional[list[tuple[str, list[list[Any]]]]]:
    """Read legacy XLS through LibreOffice, which handles supplier-specific RK quirks."""
    exe = shutil.which("libreoffice") or shutil.which("soffice")
    if not exe:
        return None
    with tempfile.TemporaryDirectory(prefix="perfume_xls_") as tmp_name:
        tmp = Path(tmp_name)
        cmd = [exe, "--headless", "--convert-to", "xlsx", "--outdir", str(tmp), str(path)]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RuntimeError(f"Не удалось запустить LibreOffice для {path.name}: {exc}") from exc
        converted = tmp / (path.stem + ".xlsx")
        if proc.returncode != 0 or not converted.exists():
            detail = (proc.stderr or proc.stdout or "нет подробностей").strip()
            raise RuntimeError(f"LibreOffice не смог преобразовать {path.name} в XLSX: {detail}")
        # XLSX reader uses data_only=True, so calculated cell values are read as values.
        return read_xlsx(converted)


def _read_xls_via_xlrd(path: Path) -> list[tuple[str, list[list[Any]]]]:
    import xlrd  # type: ignore
    book = xlrd.open_workbook(str(path), on_demand=False)
    result = []
    for sheet in book.sheets():
        matrix = []
        for r in range(sheet.nrows):
            row = []
            for c in range(sheet.ncols):
                cell = sheet.cell(r, c)
                value = cell.value
                if cell.ctype == xlrd.XL_CELL_EMPTY or cell.ctype == xlrd.XL_CELL_BLANK:
                    value = None
                elif cell.ctype == xlrd.XL_CELL_DATE:
                    try: value = xlrd.xldate.xldate_as_datetime(value, book.datemode).isoformat()
                    except Exception: value = str(value)
                elif cell.ctype == xlrd.XL_CELL_NUMBER and c == 0 and 0 < abs(float(value)) < 1e-290:
                    # Legacy article-code repair for a known malformed XLS writer.
                    raw_bits = struct.unpack("<Q", struct.pack("<d", float(value)))[0]
                    value = str(((raw_bits >> 32) & 0xFFFFFFFF) >> 2)
                row.append(value)
            matrix.append(row)
        result.append((sheet.name, matrix))
    return result


def _looks_like_broken_rk_values(workbooks: list[tuple[str, list[list[Any]]]]) -> bool:
    """Identify many huge non-article numeric cells that signal bad RK decoding."""
    for _sheet, matrix in workbooks:
        ncols = max((len(row) for row in matrix), default=0)
        for col in range(1, ncols):
            huge = [v for row in matrix if col < len(row) for v in [row[col]]
                    if isinstance(v, (int, float)) and not isinstance(v, bool)
                    and math.isfinite(float(v)) and abs(float(v)) >= 100_000_000]
            if len(huge) >= 10:
                return True
    return False


def _read_xls_via_excel_com(path: Path) -> Optional[list[tuple[str, list[list[Any]]]]]:
    """Use installed Microsoft Excel on Windows to repair supplier-specific RK cells."""
    if os.name != "nt":
        return None
    try:
        import win32com.client  # type: ignore
    except ImportError:
        return None
    app = book = None
    with tempfile.TemporaryDirectory(prefix="perfume_excel_") as tmp_name:
        target = Path(tmp_name) / (path.stem + ".xlsx")
        try:
            app = win32com.client.DispatchEx("Excel.Application")
            app.Visible = False
            app.DisplayAlerts = False
            book = app.Workbooks.Open(str(path.resolve()), ReadOnly=True, UpdateLinks=0)
            book.SaveAs(str(target), FileFormat=51)  # xlOpenXMLWorkbook
            book.Close(False); book = None
            return read_xlsx(target)
        except Exception as exc:
            raise RuntimeError(f"Microsoft Excel не смог восстановить {path.name}: {exc}") from exc
        finally:
            if book is not None:
                try: book.Close(False)
                except Exception: pass
            if app is not None:
                try: app.Quit()
                except Exception: pass


def read_xls(path: Path) -> list[tuple[str, list[list[Any]]]]:
    """Read legacy XLS without accepting corrupt RK values as prices.

    A pair of supplier exports used by this project contains malformed RK numeric
    cells. LibreOffice/Excel repairs those values; a raw BIFF decode produces values
    such as 271059712 instead of a normal price. Never silently import those numbers.
    """
    lo_error = None
    try:
        result = _read_xls_via_libreoffice(path)
        if result is not None:
            if _looks_like_broken_rk_values(result):
                raise RuntimeError("LibreOffice returned suspicious numeric values")
            return result
    except RuntimeError as exc:
        lo_error = str(exc)

    try:
        result = _read_xls_via_xlrd(path)
        if not _looks_like_broken_rk_values(result):
            return result
    except ImportError:
        result = None
    except Exception as exc:
        result = None
        lo_error = (lo_error + "; " if lo_error else "") + str(exc)

    try:
        result = _read_xls_via_excel_com(path)
        if result is not None and not _looks_like_broken_rk_values(result):
            return result
    except RuntimeError as exc:
        lo_error = (lo_error + "; " if lo_error else "") + str(exc)

    # The built-in BIFF reader is useful for ordinary files, but known broken-RK
    # exports must be rejected instead of polluting the catalogue with giant prices.
    result = _xls_biff_rows(path)
    if not _looks_like_broken_rk_values(result):
        return result
    raise RuntimeError(
        f"Файл {path.name} использует повреждённые числовые ячейки XLS (RK). "
        "Для корректного чтения установите LibreOffice (рекомендуется) либо Microsoft Excel "
        "на компьютере, где запущен бот. Импорт остановлен на уровне файла, чтобы не "
        "создавать сотни ложных ошибок и не записывать цены вида 271059712. "
        + ("Подробности: " + lo_error if lo_error else "")
    )

# ---------------------------------------------------------------------------
# Workbook ingestion and header detection
# ---------------------------------------------------------------------------
HEADER_SYNONYMS = {
    "article": ["артикул", "sku", "код товара", "код", "article", "art.", "арт", "item code"],
    "name": ["наименование", "номенклатура", "наименование товара", "название", "товар", "product", "item name", "description"],
    "price": ["цена", "оптовая цена", "опт. цена", "стоимость", "price", "wholesale", "usd"],
    "brand": ["бренд", "brand", "производитель", "марка", "trade mark"],
    "volume": ["объем", "объём", "volume", "литраж"],
    "size": ["размер", "габариты", "размеры", "size", "dimensions", "dimension"],
    "width": ["ширина", "width", "шир."],
    "height": ["высота", "height", "выс."],
    "type": ["тип парфюмерии", "концентрация", "тип", "type"],
    "gender": ["пол", "gender", "sex"],
}
PRICE_HEADER_BAD = ("заказ", "сумма", "order", "quantity", "количество", "qty", "итого", "total", "остаток")
META_RE = re.compile(r"(?i)^\s*(?:тел(?:ефон)?|phone|e-?mail|email|адрес|address|www\.|https?://|@\w+\.)")
TOTAL_RE = re.compile(r"(?i)^\s*(?:итого|всего|total|сумма(?:\s+вашего\s+заказа)?|заказ\s*:|order\s+total)\b")
SECTION_SKIP_TERMS = re.compile(r"(?i)\b(?:edp|edt|edc|parfum|perfume|туалетн\w*\s+вод\w*|парфюм\w*\s+вод\w*|духи|лосион|лосьон|крем|gel|гель|shampoo|шампунь|mascara|тушь|set|набор|ml|мл)\b")
SECTION_CATEGORY_PREFIXES = ("тушь", "помада", "крем", "шампунь", "маска", "блеск", "духи", "косметика", "спрей")

# A workbook without recognizable Name + Price headers must prove that it contains
# actual perfume/cosmetics catalogue rows before it can be imported.
PRODUCT_IDENTITY_RE = re.compile(
    r"(?i)\b(?:edp|edt|edc|extrait|parfum|perfume|fragrance|cologne|eau\s+de|"
    r"tester|sample|miniature|набор|парфюм\w*|духи|туалетн\w*\s+вод\w*|"
    r"парфюмерн\w*\s+вод\w*|маскар\w*|mascara|тушь|lipstick|помад\w*|"
    r"shampoo|шампун\w*|крем\w*|cream|body\s+lotion|лосьон\w*|gel|гель|"
    r"маск\w*|mask|conditioner|кондиционер\w*|serum|сыворотк\w*|foundation|"
    r"тональн\w*|powder|пудр\w*|blush|румян\w*|deodorant|дезодорант\w*|"
    r"aftershave|бальзам\w*|\d+(?:[.,]\d+)?\s*(?:ml|мл|oz|fl\.?\s*oz|г|гр|g)\b)"
)


class InvalidPriceListError(ValueError):
    """Raised when an uploaded workbook is not a recognizable product price list."""


def _header_score(cells: list[Any]) -> tuple[int, set[str]]:
    hits: set[str] = set()
    for value in cells:
        if is_empty(value): continue
        text = normalize_text(value).casefold()
        for role, hints in HEADER_SYNONYMS.items():
            if role in hits: continue
            for hint in hints:
                if hint in text:
                    if role == "price" and any(bad in text for bad in PRICE_HEADER_BAD):
                        continue
                    hits.add(role); break
    return len(hits), hits


def detect_header(rows: list[dict[str, Any]]) -> Optional[int]:
    best_idx, best_score = None, 0
    for i, row in enumerate(rows[:50]):
        score, hits = _header_score(row["cells"])
        # name and price together are a strong signature; article/name is also useful.
        if score > best_score:
            best_idx, best_score = i, score
        if "name" in hits and "price" in hits and ("article" in hits or score >= 3):
            return i
    return best_idx if best_score >= 2 else None


def map_header(cells: list[Any]) -> dict[str, int]:
    roles: dict[str, int] = {}
    price_candidates: list[tuple[int, str]] = []
    for col, value in enumerate(cells):
        if is_empty(value):
            continue
        text = normalize_text(value).casefold()
        for role, hints in HEADER_SYNONYMS.items():
            if not any(h in text for h in hints):
                continue
            if role == "price":
                if not any(bad in text for bad in PRICE_HEADER_BAD):
                    price_candidates.append((col, text))
                break
            roles.setdefault(role, col)
            break
    if price_candidates:
        exact = [x for x in price_candidates if x[1] in ("цена", "price", "оптовая цена", "wholesale price", "цена 1")]
        roles["price"] = (exact or price_candidates)[0][0]
    return roles


def _infer_roles(rows: list[dict[str, Any]], start: int) -> dict[str, int]:
    if not rows: return {}
    ncols = max((len(r["cells"]) for r in rows), default=0)
    stats = []
    for c in range(ncols):
        vals = [r["cells"][c] for r in rows[start:] if c < len(r["cells"]) and not is_empty(r["cells"][c])]
        if not vals: continue
        text_vals = [str(v) for v in vals]
        numeric = [v for v in vals if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(float(v))]
        avg_len = sum(len(s) for s in text_vals) / len(text_vals)
        numeric_ratio = len(numeric) / len(vals)
        stats.append({"col": c, "avg_len": avg_len, "numeric_ratio": numeric_ratio, "numeric": numeric,
                      "string_ratio": sum(isinstance(v, str) for v in vals) / len(vals)})
    out = {}
    name_cands = [s for s in stats if s["string_ratio"] > .55 and s["avg_len"] > 12]
    if name_cands: out["name"] = max(name_cands, key=lambda s: s["avg_len"])["col"]
    numeric_cands = [s for s in stats if s["numeric_ratio"] > .7]
    price_cands = [s for s in numeric_cands if s["col"] != out.get("name") and any(not float(v).is_integer() for v in s["numeric"])]
    if price_cands: out["price"] = max(price_cands, key=lambda s: s["numeric_ratio"])["col"]
    elif numeric_cands: out["price"] = numeric_cands[-1]["col"] if len(numeric_cands) > 1 else numeric_cands[0]["col"]
    for s in numeric_cands:
        if s["col"] != out.get("price") and "article" not in out:
            out["article"] = s["col"]
    return out


def read_xlsx(path: Path) -> list[tuple[str, list[list[Any]]]]:
    try:
        from openpyxl import load_workbook  # type: ignore
    except ImportError as e:
        raise RuntimeError("Для чтения .xlsx установите openpyxl: pip install openpyxl") from e
    wb = load_workbook(path, read_only=True, data_only=True)
    result = []
    for ws in wb.worksheets:
        matrix = []
        for row in ws.iter_rows(values_only=True): matrix.append([json_safe(v) for v in row])
        result.append((ws.title, matrix))
    wb.close()
    return result


def read_csv(path: Path) -> list[tuple[str, list[list[Any]]]]:
    last_err = None
    for enc in ("utf-8-sig", "utf-8", "cp1251", "latin1"):
        try:
            with path.open("r", encoding=enc, newline="") as f:
                sample = f.read(65536); f.seek(0)
                try: dialect = csv.Sniffer().sniff(sample, delimiters=";,\t|"); delim = dialect.delimiter
                except csv.Error: delim = ";"
                return [(path.stem, [list(row) for row in csv.reader(f, delimiter=delim)])]
        except Exception as exc: last_err = exc
    raise RuntimeError(f"Не удалось прочитать CSV/TSV {path}: {last_err}")


def read_workbook(path: Path) -> list[tuple[str, list[list[Any]]]]:
    ext = path.suffix.casefold()
    if ext == ".xls": return read_xls(path)
    if ext in (".xlsx", ".xlsm"): return read_xlsx(path)
    if ext in (".csv", ".tsv", ".txt"): return read_csv(path)
    raise ValueError(f"Неподдерживаемый формат: {path.name}")

# ---------------------------------------------------------------------------
# Brand dictionaries
# ---------------------------------------------------------------------------
def load_json(path: Path, default: Any) -> Any:
    try: return json.loads(path.read_text(encoding="utf-8"))
    except Exception: return default


@dataclass
class BrandIndex:
    brands: list[dict[str, Any]]
    alias_map: dict[str, list[str]]
    brand_by_norm: dict[str, dict[str, Any]]
    alias_rows: list[dict[str, Any]]


def build_brand_index(brands_path: Path, aliases_path: Path) -> BrandIndex:
    items = load_json(brands_path, [])
    if isinstance(items, dict): items = list(items.values())
    brands, alias_map, alias_rows, brand_by_norm = [], defaultdict(list), [], {}
    for item in items:
        if isinstance(item, str): item = {"name": item, "sources": []}
        if not isinstance(item, dict) or not item.get("name"): continue
        b = dict(item); b["name"] = normalize_text(b["name"]); b["normalized_name"] = normalize_brand(b["name"])
        b.setdefault("sources", []); b.setdefault("aliases", []); brands.append(b)
        brand_by_norm.setdefault(b["normalized_name"], b)
        possible = [b["name"], *b.get("aliases", [])]
        possible.extend(x.strip() for x in re.split(r"\s*(?:/|\\)\s*", b["name"]) if x.strip())
        # High-precision aliases for common suffix/prefix variants encountered in price lists.
        qualifier_patterns = [
            r"\s+(?:perfumes?|parfums?|parfum|fragrances?|fragrance|maison de parfum|parfumerie)$",
            r"^(?:parfums?|perfumes?|fragrances?|fragrance)\s+",
        ]
        for qualifier in qualifier_patterns:
            short = re.sub(qualifier, "", b["name"], flags=re.I).strip()
            if short and normalize_brand(short) != b["normalized_name"] and len(normalize_brand(short)) >= 3:
                possible.append(short)
        for alias in dict.fromkeys(possible):
            norm = normalize_brand(alias)
            if len(norm) < 2: continue
            if b["name"] not in alias_map[norm]: alias_map[norm].append(b["name"])
            alias_rows.append({"alias": alias, "normalized_alias": norm, "canonical": b["name"], "source": "brands_all.json",
                               "confidence": 1.0 if norm == b["normalized_name"] else 0.96, "ambiguous": 0})
    custom = load_json(aliases_path, {})
    for item in custom.get("aliases", []) if isinstance(custom, dict) else []:
        alias, canonical = item.get("alias"), item.get("canonical")
        if not alias or not canonical: continue
        norm = normalize_brand(alias)
        match = brand_by_norm.get(normalize_brand(canonical))
        if match is None:
            match = {"name": canonical, "normalized_name": normalize_brand(canonical), "sources": ["curated_alias"], "aliases": []}
            brands.append(match); brand_by_norm[match["normalized_name"]] = match
        if canonical not in alias_map[norm]: alias_map[norm].append(canonical)
        alias_rows.append({"alias": alias, "normalized_alias": norm, "canonical": canonical, "source": item.get("source", "brand_aliases.json"),
                           "confidence": float(item.get("confidence", 0.95)), "ambiguous": 0})
    for row in alias_rows: row["ambiguous"] = int(len(set(alias_map.get(row["normalized_alias"], []))) > 1)
    return BrandIndex(brands, dict(alias_map), brand_by_norm, alias_rows)


def _token_spans(text: str) -> list[tuple[str, int, int]]:
    return [(m.group(0), m.start(), m.end()) for m in re.finditer(r"[\w]+(?:['’][\w]+)*", text, flags=re.UNICODE)]


def find_brand_prefix(text: str, index: BrandIndex, max_words: int = 18) -> tuple[Optional[str], str, bool, Optional[str]]:
    spans = _token_spans(text)
    if not spans: return None, text, False, None
    for n in range(min(len(spans), max_words), 0, -1):
        prefix = normalize_brand(" ".join(t for t, _s, _e in spans[:n]))
        candidates = index.alias_map.get(prefix)
        if not candidates: continue
        candidates = list(dict.fromkeys(candidates))
        if len(candidates) == 1:
            return candidates[0], text[spans[n - 1][2]:].strip(" \t-–—,;:/|"), False, "dictionary_prefix"
        return None, text, True, "ambiguous_brand_alias:" + "|".join(candidates)
    return None, text, False, None

# ---------------------------------------------------------------------------
# Rules and title parser
# ---------------------------------------------------------------------------
def compile_regexes(patterns: Iterable[str]) -> list[re.Pattern]:
    out = []
    for pattern in patterns:
        try: out.append(re.compile(pattern, re.IGNORECASE | re.UNICODE))
        except re.error: continue
    return out


def rule_matches(text: str, rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    found = []
    for rule in rules:
        for pat in compile_regexes(rule.get("patterns", [])):
            m = pat.search(text)
            if m:
                found.append({"code": rule.get("code", rule.get("canonical", "UNKNOWN")), "label": rule.get("label", rule.get("canonical", "")), "evidence": m.group(0), "span": (m.start(), m.end()), "rule": rule})
                break
    return found


def detect_type(text: str, rules: dict[str, Any]) -> Optional[dict[str, Any]]:
    # Priority makes EDP/EDT/EDC win over category words that may be part of a perfume name.
    for rule in sorted(rules.get("type_rules", []), key=lambda x: int(x.get("priority", 0)), reverse=True):
        if any(p.search(text) for p in compile_regexes(rule.get("patterns", []))): return rule
    return None


def detect_gender(text: str, rules: dict[str, Any]) -> tuple[Optional[str], Optional[str], list[str]]:
    found = []
    for gender in ("U", "M", "F"):
        for pat in compile_regexes(rules.get("gender_rules", {}).get(gender, [])):
            for m in pat.finditer(text):
                raw = m.group(0).strip()
                # Bare 'her' is often part of fragrance names; don't classify it alone.
                if raw.casefold() == "her": continue
                found.append((m.start(), m.end(), gender, raw))
    found.sort(key=lambda x: (x[0], -(x[1]-x[0])))
    unique, taken = [], []
    for item in found:
        s, e, _g, _raw = item
        if any(s < te and e > ts for ts, te in taken): continue
        unique.append(item); taken.append((s, e))
    genders = list(dict.fromkeys(x[2] for x in unique))
    gender = "U" if len(genders) > 1 else (genders[0] if genders else None)
    raw_text = "; ".join(dict.fromkeys(x[3] for x in unique)) if unique else None
    reasons = ["conflicting_gender_markers:" + ",".join(genders)] if len(genders) > 1 else []
    return gender, raw_text, reasons


def extract_volumes(text: str, rules: dict[str, Any]) -> list[dict[str, Any]]:
    pattern = re.compile(rules.get("volume_pattern", r"(?<![\w])(?P<volume>\d+(?:[.,]\d+)?)\s*(?P<unit>ml|мл|g|gr|г|гр|oz|fl\.?\s*oz)\b"), re.IGNORECASE)
    matches=[]
    for m in pattern.finditer(text):
        val=float(m.group("volume").replace(",", "."))
        unit=re.sub(r"\s+", " ", m.group("unit").lower()).replace("мл", "ml").replace("г", "g")
        ml=val if unit in ("ml", "g", "gr") else val*29.5735295625
        matches.append({"value":round(ml,2),"source_value":val,"unit":unit,"start":m.start(),"end":m.end(),"raw":m.group(0)})
    return matches


def extract_multipack(text: str, rules: dict[str, Any]) -> Optional[dict[str, Any]]:
    pat=re.compile(rules.get("multipack_pattern",r"(?P<qty>\d+)\s*[xхX×*]\s*(?P<volume>\d+(?:[.,]\d+)?)\s*(?P<unit>ml|мл)\b"),re.IGNORECASE)
    m=pat.search(text)
    if not m:return None
    return {"qty":int(m.group("qty")),"volume_ml":round(float(m.group("volume").replace(",",".")),2),"start":m.start(),"end":m.end(),"raw":m.group(0)}


def strip_spans(text: str, spans: Iterable[tuple[int,int]]) -> str:
    spans=sorted((max(0,s),min(len(text),e)) for s,e in spans if e>s)
    merged=[]
    for s,e in spans:
        if merged and s<=merged[-1][1]:merged[-1][1]=max(merged[-1][1],e)
        else:merged.append([s,e])
    out=[];pos=0
    for s,e in merged:out.append(text[pos:s]);pos=e
    out.append(text[pos:])
    cleaned="".join(out)
    cleaned=re.sub(r"\(\s*\)"," ",cleaned);cleaned=re.sub(r"[\[\](){}]"," ",cleaned)
    cleaned=re.sub(r"\s+"," ",cleaned).strip()
    cleaned=re.sub(r"^[\s\-–—,;:/|+.]+|[\s\-–—,;:/|+.]+$","",cleaned)
    return re.sub(r"\s+"," ",cleaned).strip()


def _set_name_lists(text: str) -> list[list[str]]:
    lists=[]
    for m in re.finditer(r"\(([^()]{4,})\)",text):
        content=m.group(1).strip()
        if re.fullmatch(r"(?i)\s*(?:m|f|w|u|м|ж|муж|жен|unisex)\s*",content):continue
        if re.search(r"(?i)\b(?:ml|мл|edp|edt|edc)\b",content) and not re.search(r"[,;+]",content):continue
        if re.search(r"[,;+]",content):
            parts=[p.strip(" \t-–—") for p in re.split(r"\s*(?:\+|,|;)\s*",content) if p.strip()]
            if len(parts)>=2 and all(len(p)<=80 for p in parts):lists.append(parts)
    return lists


def remove_gender_labels_for_name(text: str, raw_title: str) -> str:
    out=re.sub(r"(?i)\(\s*[mfw uмжу]\s*\)"," ",text)
    out=re.sub(r"(?i)(?<!\w)(?:муж\.?|жен\.?|унисекс|уни\.?|wom)(?!\w)"," ",out)
    explicit_short=bool(re.search(r"(?i)(?:\(\s*[mfw u]\s*\)|\b(?:муж|жен|уни)\b)",raw_title))
    if explicit_short:out=re.sub(r"(?i)(?<!\w)(?:men|man|male|women|woman|female|girl)(?!\w)"," ",out)
    else:out=re.sub(r"(?i)(\b(?:ml|мл|edp|edt|edc|parfum|perfume)\b[\s,;/+-]*)(?:men|man|male|women|woman|female|girl)\b",r"\1",out)
    return re.sub(r"\s+"," ",out).strip()

# ---------------------------------------------------------------------------
# Row classification and structured parsing
# ---------------------------------------------------------------------------
def value_at(cells: list[Any], idx: Optional[int]) -> Any:
    return cells[idx] if idx is not None and 0 <= idx < len(cells) else None


def is_price_suspicious(price: Optional[float], rules: dict[str, Any]) -> bool:
    if price is None:
        return False
    cfg = rules.get("suspicious_price", {})
    return price <= float(cfg.get("min_exclusive", 0)) or price > float(cfg.get("max_usd", 10000))


def locate_brand_in_title(text: str, index: BrandIndex) -> tuple[Optional[str], str, bool, Optional[str]]:
    brand, tail, ambiguous, method = find_brand_prefix(text, index)
    if brand or ambiguous:
        return brand, tail, ambiguous, method
    # Some sheets prepend generic category words, e.g. "Тушь LAMEL ...".
    tokens = _token_spans(text)
    candidates = []
    for start in range(min(5, len(tokens))):
        for end in range(len(tokens), start, -1):
            if end - start > 18:
                continue
            segment = normalize_brand(text[tokens[start][1]:tokens[end - 1][2]])
            matches = index.alias_map.get(segment)
            if matches:
                names = list(dict.fromkeys(matches))
                if len(names) == 1:
                    candidates.append((end-start, -(tokens[start][1]), names[0], tokens[start][1], tokens[end-1][2]))
                else:
                    return None, text, True, "ambiguous_brand_alias:" + "|".join(names)
    if candidates:
        _size, _pos, found, start, end = max(candidates)
        tail = (text[:start] + " " + text[end:]).strip(" \t-–—,;:/|")
        return found, re.sub(r"\s+", " ", tail).strip(), False, "dictionary_early_title"
    return None, text, False, None


def extract_marker_matches(text: str, rules: dict[str, Any], key: str) -> list[dict[str, Any]]:
    raw = rules.get(key, [])
    if key in ("tester_terms", "sample_terms", "set_terms"):
        out=[]
        for patt in raw:
            try: pat = re.compile(patt, re.I | re.U)
            except re.error: continue
            for m in pat.finditer(text):
                out.append({"code": key.upper(), "label": m.group(0), "evidence": m.group(0), "span": (m.start(),m.end()), "rule": {}})
        return out
    return rule_matches(text, raw)


def _set_marker(text: str, rules: dict[str, Any]) -> bool:
    # Strong markers are product/package terms, while bare "Set" may belong to a fragrance name.
    if re.search(r"(?i)\b(?:набор\w*|coffret|gift\s*set|комплект\w*|kit)\b", text):
        return True
    if extract_multipack(text, rules):
        return True
    if _set_name_lists(text):
        return True
    outside_parens = re.sub(r"\([^()]*\)", " ", text)
    # A bare SET at the end (including "100 ml set") is meaningful; "The Smart Set 1.5 ml VIAL" is not.
    if re.search(r"(?i)\b\d+(?:[.,]\d+)?\s*(?:ml|мл)\s+set\b", outside_parens):
        return True
    if re.search(r"(?i)\bset\b", outside_parens) and re.search(r"\s*\+\s*(?=\d|[A-Za-zА-Яа-я])", outside_parens):
        return True
    return False


def _component_type(text: str, rules: dict[str, Any]) -> tuple[Optional[str], str]:
    matched = detect_type(text, rules)
    if matched:
        return matched.get("canonical"), matched.get("category", "perfume")
    matches = rule_matches(text, rules.get("type_rules", []))
    if matches:
        r = matches[0]["rule"]
        return r.get("canonical"), r.get("category", "other")
    # Components often have short retail abbreviations.
    aliases = rules.get("component_aliases", {})
    for alias, canonical in aliases.items():
        if re.search(r"(?<!\w)" + re.escape(alias) + r"(?!\w)", text, re.I):
            can = str(canonical).upper()
            return can, "perfume" if can in ("EDP","EDT","EDC") else "cosmetics"
    return None, "other"


def _gender_code(text: str, rules: dict[str, Any]) -> tuple[Optional[str], Optional[str], list[str]]:
    # detect_gender already handles overlapping/conflicting markers. Avoid re-detecting the M in brands like M.INT.
    return detect_gender(text, rules)


def _best_price_and_article(cells: list[Any], roles: dict[str,int]) -> tuple[Any, Any, Optional[float]]:
    article = value_at(cells, roles.get("article"))
    price_raw = value_at(cells, roles.get("price"))
    price = parse_price(price_raw)
    return article, price_raw, price


def _row_has_title(cells: list[Any], roles: dict[str,int]) -> Optional[str]:
    candidate = value_at(cells, roles.get("name"))
    if not is_empty(candidate):
        return normalize_text(candidate)
    # Fallback: prefer the longest readable string and do not manufacture title from numeric columns.
    strings = [normalize_text(v) for v in cells if isinstance(v, str) and normalize_text(v)]
    strings = [v for v in strings if len(v) >= 7]
    if not strings: return None
    return max(strings, key=len)


def _has_catalog_product_identity(title: Any, cells: list[Any], roles: dict[str, int],
                                  rules: dict[str, Any], index: BrandIndex) -> bool:
    """Return True only when a title has recognizable perfume/cosmetics evidence."""
    text = normalize_text(title)
    if not text:
        return False
    if PRODUCT_IDENTITY_RE.search(text):
        return True
    if detect_type(text, rules) or extract_volumes(text, rules):
        return True
    if locate_brand_in_title(text, index)[0]:
        return True

    # Structured sheets may store brand/type/volume in separate columns.
    brand_value = value_at(cells, roles.get("brand"))
    if not is_empty(brand_value):
        brand_text = normalize_text(brand_value)
        if resolve_section_brand(brand_text, index) or locate_brand_in_title(brand_text, index)[0]:
            return True
    type_value = value_at(cells, roles.get("type"))
    if not is_empty(type_value) and detect_type(normalize_text(type_value), rules):
        return True
    volume_value = value_at(cells, roles.get("volume"))
    if not is_empty(volume_value) and extract_volumes(normalize_text(volume_value), rules):
        return True
    return False


def _price_list_sheet_plan(records: list[dict[str, Any]], rules: dict[str, Any],
                           index: BrandIndex) -> dict[str, Any]:
    """Validate one worksheet and return the exact column map used for parsing.

    Explicit Name + Price headers are the strongest signal. Without both headers,
    inferred columns are accepted only when at least two rows have a recognizable
    perfume/cosmetics identity AND an actual parseable price. This prevents date,
    count, and statistics columns from being mistaken for prices.
    """
    header_idx = detect_header(records)
    if header_idx is not None:
        header_roles = map_header(records[header_idx]["cells"])
        roles = dict(header_roles)
        inferred = _infer_roles(records, header_idx + 1)
        roles.setdefault("name", inferred.get("name"))
        roles.setdefault("price", inferred.get("price"))
        data_start = header_idx + 1
        trusted_header = "name" in header_roles and "price" in header_roles
    else:
        roles = _infer_roles(records, 0)
        data_start = 0
        trusted_header = False

    paired_price_rows = 0
    product_price_rows = 0
    for record in records[data_start:]:
        cells = record["cells"]
        title = _row_has_title(cells, roles)
        if not title:
            continue
        price = parse_price(value_at(cells, roles.get("price")))
        if price is None:
            continue
        paired_price_rows += 1
        if _has_catalog_product_identity(title, cells, roles, rules, index):
            product_price_rows += 1

    if trusted_header:
        accepted = paired_price_rows >= 1
    else:
        # Two independent product rows make inferred columns credible. A random
        # report with numeric monthly/count columns will not pass this gate.
        accepted = product_price_rows >= 2

    return {
        "accepted": accepted,
        "header_idx": header_idx,
        "roles": roles,
        "data_start": data_start,
        "trusted_header": trusted_header,
        "paired_price_rows": paired_price_rows,
        "product_price_rows": product_price_rows,
    }


def classify_source_row(cells: list[Any], roles: dict[str,int], current_section: Optional[str], rules: dict[str,Any]) -> tuple[str, Optional[str]]:
    nonempty = [normalize_text(v) for v in cells if not is_empty(v)]
    if not nonempty: return "blank", None
    joined = " | ".join(nonempty)
    if any(re.search(p, joined, re.I) for p in rules.get("row_markers", {}).get("total", [])): return "total", None
    if any(re.search(p, joined, re.I) for p in rules.get("row_markers", {}).get("meta", [])): return "metadata", None
    title_value = value_at(cells, roles.get("name"))
    if not is_empty(title_value):
        title = normalize_text(title_value)
        price_value = value_at(cells, roles.get("price"))
        other_data = [v for i,v in enumerate(cells) if not is_empty(v) and i not in (roles.get("name"), roles.get("price"))]
        looks_like_item = bool(re.search(r"(?i)\b(?:edp|edt|edc|parfum|perfume|tester|набор|set|mascara|тушь|lipstick|помада|shampoo|шампунь|крем|body lotion|ml|мл|oz|муж|жен|unisex)\b", title))
        if is_empty(price_value) and not other_data and not looks_like_item:
            return "section_header", title
        return "candidate", title
    # A one-cell row is typically a brand/category section title in vendor sheets.
    if len(nonempty) == 1:
        val=nonempty[0]
        if len(val)<=100 and not SECTION_SKIP_TERMS.search(val) and not re.search(r"\d+(?:[.,]\d+)?\s*(?:ml|мл|oz|г|g)\b", val, re.I):
            return "section_header", val
        if len(val)<=100 and re.search(r"(?i)^(?:парфюмерия|косметика|тестеры|новинки|женск\w*|мужск\w*)",val):
            return "section_header", val
    title = _row_has_title(cells, roles)
    if title and re.search(r"(?i)\b(?:edp|edt|edc|parfum|perfume|tester|набор|set|mascara|тушь|lipstick|помада|shampoo|шампунь|крем|body lotion|ml|мл|oz|муж|жен|unisex)\b",title):
        return "candidate", title
    return "preamble", None


def remove_title_markers(text: str, rules: dict[str, Any], remove_cosmetic_type: bool = False, remove_set_markers: bool = True) -> str:
    spans=[]
    for vol in extract_volumes(text, rules): spans.append((vol["start"],vol["end"]))
    type_rules=rules.get("type_rules", [])
    for rule in type_rules:
        # Preserve category terms such as "mascara"/"shampoo" as part of cosmetics product names.
        if not remove_cosmetic_type and rule.get("category") not in ("perfume", "body") and rule.get("canonical") not in ("DISPLAY", "SHOWCARD", "BILLBOARD"):
            continue
        for pat in compile_regexes(rule.get("patterns", [])):
            for m in pat.finditer(text): spans.append((m.start(),m.end()))
    for match in rule_matches(text, rules.get("defect_rules", [])): spans.append(match["span"])
    for match in rule_matches(text, rules.get("extra_info_rules", [])): spans.append(match["span"])
    for key in ("tester_terms", "sample_terms"):
        for match in extract_marker_matches(text, rules, key): spans.append(match["span"])
    for patt in rules.get("set_terms", []):
        if not remove_set_markers and re.search(r"(?i)set", patt) and not any(k in patt.casefold() for k in ("gift", "набор", "coffret", "комплект", "kit")):
            continue
        compiled = compile_regexes([patt])
        if compiled:
            for m in compiled[0].finditer(text): spans.append((m.start(),m.end()))
    for patt in (r"(?i)(?:\b(?:муж\.?|мужской|жен\.?|женский|уни\.?|унисекс|men|women|woman|male|female|homme|femme|uomo|donna|unisex)\b|\b[mfwu]\b)",
                 r"(?i)\(\s*[mfw uмжу]\s*\)", r"(?i)\b\d+\s*[xхX×*]\s*\d+(?:[.,]\d+)?\s*(?:ml|мл)\b"):
        for m in re.finditer(patt,text): spans.append((m.start(),m.end()))
    return strip_spans(text, spans)


def parse_component(raw_component: str, default_brand: Optional[str], parent_name: str,
                    parent_type: Optional[str], parent_gender: Optional[str], rules: dict[str, Any],
                    sequence: int, inherited_volume: Optional[float] = None,
                    named_override: Optional[str] = None) -> dict[str, Any]:
    raw=normalize_text(raw_component)
    typ, category = _component_type(raw, rules)
    vols=extract_volumes(raw, rules)
    volume=vols[0] if vols else None
    # A naked number after a plus is conventionally the second vial size; keep that evidence explicit.
    if volume is None:
        bare=re.search(r"(?<!\w)(\d+(?:[.,]\d+)?)\s*(?=\+|$)",raw)
        if bare:
            val=float(bare.group(1).replace(",","."))
            volume={"value":val,"source_value":val,"unit":"ml","start":bare.start(),"end":bare.end(),"raw":bare.group(0),"inferred_unit":True}
    volume_ml=None
    volume_text=None
    if volume:
        unit=volume.get("unit","ml")
        if unit in ("ml", "fl oz", "fl. oz", "oz"):
            volume_ml=round(float(volume["value"]),2)
            volume_text=(f"{volume_ml:g} ml" if unit=="ml" else f"{volume.get('source_value',volume['value']):g} oz")
        else:
            volume_text=f"{volume['source_value']:g} {unit}"
    gender, _gender_raw, _gender_reasons = _gender_code(raw,rules)
    if not gender: gender=parent_gender
    if not typ and (re.fullmatch(r"\d+(?:[.,]\d+)?\s*(?:ml|мл)?",raw,re.I) or raw in ("+", "")):
        typ=parent_type; category="perfume" if parent_type in ("EDP","EDT","EDC","PARFUM","EXTRAIT") else "other"
    brand, tail, amb, _method = locate_brand_in_title(raw, brand_index_global) if brand_index_global else (None,raw,False,None)
    component_brand=(default_brand if named_override is not None else (brand or default_brand))
    title_base=tail if brand else raw
    if named_override:
        component_name=normalize_text(named_override)
    else:
        # In a named component segment keep product-family words; remove quantities/status/modifiers.
        component_name=remove_title_markers(title_base,rules,remove_cosmetic_type=False)
        if not component_name and typ in ("EDP","EDT","EDC","PARFUM","EXTRAIT"):
            component_name=parent_name or title_base
        if not component_name:
            component_name=normalize_text(title_base) or parent_name
    component_type=typ or parent_type
    if component_type in ("EDP","EDT","EDC","PARFUM","EXTRAIT"):
        category="perfume"
    elif component_type and component_type not in ("PARFUM","EDP","EDT","EDC","EXTRAIT"):
        category=next((x.get("category") for x in rules.get("type_rules",[]) if x.get("canonical")==component_type),category)
    return {"sequence_no":sequence,"brand":component_brand,"name":component_name,"type":component_type,
            "category":category,"quantity":1,"volume_ml":volume_ml,"volume_text":volume_text,
            "gender":gender,"raw_component":raw,"needs_review":int(amb),"review_reasons":["ambiguous_component_brand"] if amb else []}


# Initialized in main, then passed indirectly to component parser.
brand_index_global: Optional[BrandIndex] = None


def split_set_components(raw: str, brand: Optional[str], parent_name: str,
                         parent_type: Optional[str], gender: Optional[str], rules: dict[str,Any]) -> tuple[list[dict[str,Any]], list[str]]:
    components=[]; reasons=[]
    # Named fragrance list within parentheses: use the count/volume to map vial names precisely.
    name_lists=_set_name_lists(raw)
    multipack=extract_multipack(raw,rules)
    if name_lists:
        names=name_lists[-1]
        if multipack and len(names)==multipack["qty"]:
            for i,nm in enumerate(names,1):
                components.append(parse_component(nm,brand,nm,parent_type,gender,rules,i,
                                                   inherited_volume=multipack["volume_ml"],named_override=nm))
                components[-1]["volume_ml"]=multipack["volume_ml"]
                components[-1]["volume_text"]=f'{multipack["volume_ml"]:g} ml'
        elif multipack and len(names)!=multipack["qty"]:
            reasons.append(f"named_component_count_{len(names)}_differs_from_pack_count_{multipack['qty']}")
            for i,nm in enumerate(names,1):
                components.append(parse_component(nm,brand,nm,parent_type,gender,rules,i,named_override=nm))
        else:
            for i,nm in enumerate(names,1): components.append(parse_component(nm,brand,nm,parent_type,gender,rules,i,named_override=nm))
        return components,reasons

    # A product-list with volume/type chunks in parentheses (e.g. EDT 100 ml + 15 ml + Body Lotion).
    paren=re.search(r"\(([^()]{3,})\)",raw)
    if paren and re.search(r"(?i)\b(?:edp|edt|edc|ml|мл|body lotion|shower gel|b/l|s/g)\b",paren.group(1)) and re.search(r"[+;]",paren.group(1)):
        text=paren.group(1)
        parts=[p.strip() for p in re.split(r"\s*(?:\+|;)\s*",text) if p.strip()]
        previous_type=parent_type; previous_name=parent_name
        for i,part in enumerate(parts,1):
            c=parse_component(part,brand,previous_name,previous_type,gender,rules,i)
            if not re.search(r"(?i)\b(?:edp|edt|edc|parfum|perfume|туалетн\w*|парфюмированн\w*)\b",part) and c.get("type") is None:
                c["name"]=previous_name
            if c.get("type"): previous_type=c["type"]
            if c.get("name"): previous_name=c["name"]
            components.append(c)
        return components,reasons

    # Explicit plus/semicolon separation. Skip plus signs inside the fragrance-name parentheses already handled above.
    no_parens=re.sub(r"\([^()]*\)"," ",raw)
    if re.search(r"\s*\+\s*(?=\d|[A-Za-zА-Яа-я])|;",no_parens):
        parts=[p.strip() for p in re.split(r"\s*\+\s*|\s*;\s*",no_parens) if p.strip()]
        # Only activate if there are at least two volume-bearing or recognizable product components.
        volumes_count=sum(bool(extract_volumes(p,rules)) or bool(re.search(r"(?<!\w)\d+(?:[.,]\d+)?\s*$",p)) for p in parts)
        if len(parts)>=2 and (volumes_count>=2 or sum(bool(_component_type(p,rules)[0]) for p in parts)>=2):
            prev_type=parent_type; prev_name=parent_name
            for i,part in enumerate(parts,1):
                c=parse_component(part,brand,prev_name,prev_type,gender,rules,i)
                if not c["name"] or c["name"].isdigit(): c["name"]=prev_name
                if not re.search(r"(?i)\b(?:edp|edt|edc|parfum|perfume|туалетн\w*|парфюмированн\w*)\b",part) and c.get("type") is None:
                    c["type"]=prev_type
                    if prev_type in ("EDP","EDT","EDC","PARFUM","EXTRAIT"): c["category"]="perfume"
                if c.get("type"): prev_type=c["type"]
                if c.get("name"): prev_name=c["name"]
                components.append(c)
            return components,reasons

    if multipack:
        # If distinct names weren't listed, represent count + unit size as a single repeated component.
        components.append({"sequence_no":1,"brand":brand,"name":parent_name or raw,"type":parent_type,
                           "category":"perfume" if parent_type in ("EDP","EDT","EDC","PARFUM","EXTRAIT") else "other",
                           "quantity":multipack["qty"],"volume_ml":multipack["volume_ml"],
                           "volume_text":f'{multipack["volume_ml"]:g} ml',"gender":gender,
                           "raw_component":multipack["raw"],"needs_review":0,"review_reasons":[]})
    return components,reasons


def _column_gender(v: Any) -> Optional[str]:
    if is_empty(v): return None
    s=normalize_text(v).casefold()
    if s in ("m","male","men","man","м","муж","мужской"): return "M"
    if s in ("f","w","female","women","woman","ж","жен","женский"): return "F"
    if s in ("u","unisex","uni","уни","унисекс"): return "U"
    return None


def _currency_from_value(v: Any) -> str:
    s=str(v or "").casefold()
    if "€" in s or "eur" in s: return "EUR"
    if "₽" in s or "руб" in s or "rur" in s: return "RUB"
    if "uah" in s or "грн" in s: return "UAH"
    if "$" in s or "usd" in s: return "USD"
    return "USD"


def parse_product_row(raw_title: str, cells: list[Any], roles: dict[str,int], section_brand: Optional[str],
                      source_file: str, sheet_name: str, row_number: int, source_row_id: int,
                      rules: dict[str,Any], set_rules: dict[str,Any], index: BrandIndex,
                      product_id: int) -> tuple[dict[str,Any], list[dict[str,Any]], list[str]]:
    global brand_index_global
    brand_index_global=index
    raw=normalize_text(raw_title)
    article_raw=value_at(cells,roles.get("article"))
    article=to_text(article_raw)
    price_raw=value_at(cells,roles.get("price"))
    price=parse_price(price_raw)
    reasons=[]
    if price_raw is None or is_empty(price_raw): reasons.append("missing_price")
    if is_price_suspicious(price,rules):
        reasons.append("price_out_of_expected_range_not_imported_as_numeric")
        price=None
    currency=_currency_from_value(price_raw)

    brand, tail, brand_ambiguous, brand_method=locate_brand_in_title(raw,index)
    explicit_brand=value_at(cells,roles.get("brand"))
    if not brand and not is_empty(explicit_brand):
        mapped=resolve_section_brand(normalize_text(explicit_brand),index)
        brand=mapped or normalize_text(explicit_brand)
        tail=raw; brand_method="brand_column"
    if not brand and section_brand:
        brand=section_brand; tail=raw; brand_method="section_header"
    if brand_ambiguous:
        reasons.append("ambiguous_brand")
    if not brand:
        reasons.append("brand_not_matched_to_dictionary")

    typ_rule=detect_type(raw,rules)
    typ=typ_rule.get("canonical") if typ_rule else None
    category=typ_rule.get("category") if typ_rule else "other"
    col_type=value_at(cells,roles.get("type"))
    if not typ and not is_empty(col_type):
        typ_rule=detect_type(normalize_text(col_type),rules)
        if typ_rule: typ=typ_rule.get("canonical"); category=typ_rule.get("category")
    if typ is None:
        # Try literal type abbreviations/translated markers via the same rules.
        typ2, cat2=_component_type(raw,rules)
        if typ2: typ=typ2; category=cat2
    if typ is None:
        reasons.append("type_not_recognized")

    display_kind_map={"DISPLAY":"display","SHOWCARD":"showcard","BILLBOARD":"billboard"}
    display_kind=display_kind_map.get(str(typ or "").upper())
    dimensions={"size_width":None,"size_height":None,"size_unit":None,"raw":None}
    if display_kind:
        dimension_source=" ".join(x for x in [raw,to_text(value_at(cells,roles.get("size"))),to_text(value_at(cells,roles.get("width"))),to_text(value_at(cells,roles.get("height")))] if x)
        dimensions=extract_display_dimensions(dimension_source,value_at(cells,roles.get("width")),value_at(cells,roles.get("height")))
        if not dimensions.get("size_width") or not dimensions.get("size_height"):
            reasons.append("display_size_missing")

    gender, gender_raw, gender_reasons=_gender_code(raw,rules)
    reasons.extend(gender_reasons)
    if not gender: gender=_column_gender(value_at(cells,roles.get("gender")))

    volumes=[] if display_kind else extract_volumes(raw,rules)
    vol_column=None if display_kind else value_at(cells,roles.get("volume"))
    vol_from_column=None
    if not volumes and not is_empty(vol_column):
        m=re.search(r"(\d+(?:[.,]\d+)?)\s*(ml|мл|g|gr|г|гр|oz|fl\.?\s*oz)?",normalize_text(vol_column),re.I)
        if m:
            n=float(m.group(1).replace(",",".")); unit=(m.group(2) or "ml").casefold().replace("мл","ml").replace("г","g")
            vol_from_column={"value":n*29.5735295625 if "oz" in unit else n,"source_value":n,"unit":unit,"raw":m.group(0)}
    volume=volumes[0] if volumes else vol_from_column
    volume_ml=None; volume_text=None
    if volume:
        unit=volume.get("unit","ml")
        if unit in ("ml", "oz", "fl oz", "fl. oz"):
            volume_ml=round(float(volume["value"]),2)
            volume_text=f"{volume_ml:g} ml"
        else:
            volume_ml=None
            unit_label="g" if unit in ("g","gr") else unit
            volume_text=f"{float(volume['source_value']):g} {unit_label}"

    defect_matches=rule_matches(raw,rules.get("defect_rules",[]))
    defects=[]
    for m in defect_matches:
        if m["code"] not in defects: defects.append(m["code"])
    extra_matches=rule_matches(raw,rules.get("extra_info_rules",[]))
    extras=list(dict.fromkeys([m["evidence"] for m in extra_matches]))
    tester=bool(extract_marker_matches(raw,rules,"tester_terms"))
    sample=bool(extract_marker_matches(raw,rules,"sample_terms"))
    if sample: extras.append("SAMPLE/DECANT marker")

    multipack=extract_multipack(raw,set_rules)
    plus_parts=len(re.findall(r"\s*\+\s*(?=\d|[A-Za-zА-Яа-я])",re.sub(r"\([^()]*\)"," ",raw)))
    looks_set=_set_marker(raw,set_rules) or bool(multipack) or (plus_parts>=1 and len(volumes)>=2)
    if typ and category in ("makeup","cosmetics","hair","home","body"):
        pass
    # Derive a clean name. For a multi-item set, parse only the first component as the set's naming anchor.
    name_seed=raw
    if looks_set:
        name_seed=re.sub(r"\([^()]*[+,;][^()]*\)"," ",name_seed)
        name_seed=re.split(r"\s*\+\s*",name_seed,maxsplit=1)[0]
        name_seed=re.split(r"\s*;\s*",name_seed,maxsplit=1)[0]
    _seed_brand, seed_tail, _seed_ambiguous, _seed_method=locate_brand_in_title(name_seed,index)
    if _seed_brand:
        clean_tail=seed_tail
    else:
        clean_tail=name_seed
    if display_kind:
        clean_tail=DISPLAY_SIZE_RE.sub(" ",clean_tail)
        clean_tail=re.sub(r"(?i)\b(?:display|showcard|show\s*card|billboard|bill\s*board|шоукард|билборд|дисплей|воблер)\b"," ",clean_tail)
    clean_tail=remove_gender_labels_for_name(clean_tail,raw)
    name=remove_title_markers(clean_tail,rules,remove_cosmetic_type=False,remove_set_markers=looks_set)
    if looks_set:
        name=re.sub(r"(?i)\b(?:tester|tst|тестер|набор|set|gift\s*set|coffret|комплект|kit)\b"," ",name)
    else:
        name=re.sub(r"(?i)\b(?:tester|tst|тестер|набор|gift\s*set|coffret|комплект|kit)\b"," ",name)
    name=re.sub(r"\s+"," ",name).strip(" -–—,;:/|+")
    if not name and looks_set and brand:
        name=f"{brand} Set"
    if not name: name=clean_tail or raw
    if not name: reasons.append("empty_parsed_name")
    if not brand: reasons.append("brand_missing")
    if brand_ambiguous and "ambiguous_brand" not in reasons: reasons.append("ambiguous_brand")

    component_rows=[]
    component_reasons=[]
    if looks_set:
        component_rows,component_reasons=split_set_components(raw,brand,name,typ,gender,rules)
        reasons.extend(component_reasons)
        if not component_rows:
            reasons.append("set_components_unknown")
        if multipack and component_rows and len(component_rows)==1 and component_rows[0].get("quantity")==1:
            component_rows[0]["quantity"]=multipack["qty"]
        if len(component_rows)==1 and component_rows[0].get("quantity",1)==1 and multipack:
            component_rows[0]["quantity"]=multipack["qty"]
        # Parent row represents the whole set, not an arbitrary first item's volume.
        volume_ml=None
        volume_text=multipack["raw"] if multipack else None
    else:
        component_rows=[]

    if not brand or not name or not typ or reasons:
        confidence=0.45 if not brand or not name else 0.62
    else:
        confidence=0.94 if brand_method=="dictionary_prefix" else (0.88 if brand_method else 0.82)
    review=bool(reasons)
    row={
        "id":product_id,"source_row_id":source_row_id,"article":article,"article_raw":to_text(article_raw),
        "brand":brand,"brand_match_method":brand_method,"name":name,"type":typ,"category":category or "other",
        "display_kind":display_kind,"size_width":dimensions.get("size_width"),"size_height":dimensions.get("size_height"),"size_unit":dimensions.get("size_unit"),
        "defects":defects,"volume_ml":None if display_kind else volume_ml,"volume_text":None if display_kind else volume_text,
        "price_usd":price,"price_raw":to_text(price_raw),"currency":currency,
        "gender":gender,"gender_from_name":gender_raw,"is_tester":int(tester),"is_sample":int(sample),
        "is_set":int(looks_set),"extra_info":list(dict.fromkeys(extras)),"raw_title":raw,
        "raw_cells":cells,"source_file":source_file,"source_sheet":sheet_name,"source_row_number":row_number,
        "parse_confidence":round(confidence,2),"needs_review":int(review),"review_reasons":list(dict.fromkeys(reasons)),
        "set_component_count":len(component_rows),"brand_match_method":brand_method,
    }
    for component in component_rows:
        component["parent_product_id"]=product_id
        if component.get("needs_review"): row["needs_review"]=1
    return row,component_rows,list(dict.fromkeys(reasons))


def resolve_section_brand(value: Optional[str], index: BrandIndex) -> Optional[str]:
    if not value: return None
    norm=normalize_brand(value)
    candidates=index.alias_map.get(norm,[])
    return candidates[0] if len(set(candidates))==1 else None


def process_workbook_rows(workbooks: list[tuple[str,str,list[list[Any]]]], rules: dict[str,Any],
                          set_rules: dict[str,Any], index: BrandIndex) -> dict[str,Any]:
    source_rows=[]; products=[]; components=[]; price_lists=[]; stats={"files":{},"status_counts":Counter()}
    file_ids={}
    next_source_id=1; next_product_id=1

    # Validate sheets before constructing any product rows. Non-price-list sheets
    # in a multi-sheet workbook are skipped; a file with no valid sheet is rejected.
    prepared=[]
    seen_files=[]
    accepted_files=set()
    for file_name,sheet_name,matrix in workbooks:
        if file_name not in seen_files:
            seen_files.append(file_name)
        records=[{"row_number":i+1,"cells":[json_safe(v) for v in cells]} for i,cells in enumerate(matrix)]
        plan=_price_list_sheet_plan(records,rules,index)
        if plan["accepted"]:
            prepared.append((file_name,sheet_name,records,plan))
            accepted_files.add(file_name)

    rejected_files=[name for name in seen_files if name not in accepted_files]
    if rejected_files:
        names=", ".join(rejected_files[:3])
        if len(rejected_files)>3:
            names += f" и ещё {len(rejected_files)-3}"
        raise InvalidPriceListError(
            f"Файл «{names}» не распознан как прайс-лист. Не найдены подтверждённые заголовки «Наименование» и «Цена» "
            "или минимум две товарные строки парфюмерии/косметики с числовыми ценами. "
            "Документы, отчёты и таблицы статистики не импортируются как товары."
        )

    for file_name,sheet_name,records,plan in prepared:
        if file_name not in file_ids:
            file_ids[file_name]=len(file_ids)+1
            price_lists.append({"id":file_ids[file_name],"filename":file_name,"supplier_name":Path(file_name).stem,
                                "imported_at":datetime.now().strftime("%Y-%m-%d %H:%M:%S"),"parser_version":PARSER_VERSION})
        header_idx=plan["header_idx"]
        roles=plan["roles"]
        trusted_header=plan["trusted_header"]
        file_stat=stats["files"].setdefault(file_name,{"sheets":{},"physical_rows":0,"products":0,"components":0,"review":0,"suspicious_prices":0})
        file_stat["sheets"][sheet_name]={"header_row":header_idx+1 if header_idx is not None else None,
                                          "column_roles":roles,"physical_rows":len(records),
                                          "price_list_validation":{"paired_price_rows":plan["paired_price_rows"],
                                                                    "product_price_rows":plan["product_price_rows"],
                                                                    "trusted_header":trusted_header}}
        current_section=None; current_section_brand=None
        sheet_stat={"products":0,"components":0,"review":0,"suspicious_prices":0}
        for rec in records:
            cells=rec["cells"]; rownum=rec["row_number"]; source_id=next_source_id; next_source_id+=1
            if header_idx is not None and rownum-1==header_idx:
                status="header"; title=None; reason=None
            else:
                status,title=classify_source_row(cells,roles,current_section,rules); reason=None
                # In a sheet whose columns were inferred, don't promote arbitrary
                # labels/notes into products just because other cells contain numbers.
                if status=="candidate" and not trusted_header and not _has_catalog_product_identity(title,cells,roles,rules,index):
                    status="preamble"; title=None
            raw_price=to_text(value_at(cells,roles.get("price")))
            prod_id=None
            if status=="section_header" and title:
                current_section=title
                current_section_brand=resolve_section_brand(title,index)
            product=None; children=[]; product_reasons=[]
            if status=="candidate" and title:
                # A section label can be present in the first column while the actual brand is in the title.
                product,children,product_reasons=parse_product_row(title,cells,roles,current_section_brand,file_name,sheet_name,rownum,source_id,rules,set_rules,index,next_product_id)
                prod_id=next_product_id; next_product_id+=1
                products.append(product); components.extend(children)
                if product["needs_review"]:
                    status="product_review"; sheet_stat["review"]+=1; file_stat["review"]+=1
                else: status="product"
                sheet_stat["products"]+=1; file_stat["products"]+=1
                sheet_stat["components"]+=len(children); file_stat["components"]+=len(children)
                if "price_out_of_expected_range_not_imported_as_numeric" in product_reasons:
                    sheet_stat["suspicious_prices"]+=1; file_stat["suspicious_prices"]+=1
                reason=";".join(product_reasons) if product_reasons else None
            source_rows.append({"id":source_id,"price_list_id":file_ids[file_name],"source_file":file_name,"source_sheet":sheet_name,
                                "source_row_number":rownum,"row_status":status,"title_candidate":title,"raw_price":raw_price,
                                "column_roles":roles,"raw_cells":cells,"product_id":prod_id,"notes":reason})
            stats["status_counts"][status]+=1
            file_stat["physical_rows"]+=1
        file_stat["sheets"][sheet_name]["parsed_products"]=sheet_stat["products"]
        file_stat["sheets"][sheet_name]["set_components"]=sheet_stat["components"]
        file_stat["sheets"][sheet_name]["review_rows"]=sheet_stat["review"]
    stats["totals"]={"source_rows":len(source_rows),"products":len(products),"components":len(components),
                      "review_products":sum(p["needs_review"] for p in products),
                      "sets":sum(p["is_set"] for p in products),"brands_loaded":len(index.brands)}
    stats["status_counts"]=dict(stats["status_counts"])
    return {"source_rows":source_rows,"products":products,"components":components,"price_lists":price_lists,"stats":stats}

# ---------------------------------------------------------------------------
# MariaDB schema, SQL dump, and audit exports
# ---------------------------------------------------------------------------
SCHEMA_STATEMENTS = [
"""CREATE TABLE IF NOT EXISTS brands (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  normalized_name VARCHAR(255) NOT NULL,
  sources_json LONGTEXT NULL,
  aliases_json LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_brands_normalized (normalized_name),
  KEY idx_brands_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",
"""CREATE TABLE IF NOT EXISTS brand_aliases (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  alias VARCHAR(255) NOT NULL,
  normalized_alias VARCHAR(255) NOT NULL,
  canonical_brand VARCHAR(255) NOT NULL,
  brand_id BIGINT UNSIGNED NULL,
  source VARCHAR(100) NULL,
  confidence DECIMAL(5,4) NULL,
  ambiguous TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_brand_alias_normalized (normalized_alias),
  KEY idx_brand_alias_canonical (canonical_brand),
  CONSTRAINT fk_brand_alias_brand FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",
"""CREATE TABLE IF NOT EXISTS price_lists (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  supplier_name VARCHAR(255) NULL,
  imported_at DATETIME NOT NULL,
  parser_version VARCHAR(32) NOT NULL,
  UNIQUE KEY uq_price_lists_filename (filename)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",
"""CREATE TABLE IF NOT EXISTS source_rows (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  price_list_id BIGINT UNSIGNED NOT NULL,
  source_file VARCHAR(255) NOT NULL,
  source_sheet VARCHAR(255) NOT NULL,
  source_row_number INT UNSIGNED NOT NULL,
  row_status VARCHAR(32) NOT NULL,
  title_candidate TEXT NULL,
  raw_price VARCHAR(255) NULL,
  column_roles_json LONGTEXT NULL,
  raw_cells_json LONGTEXT NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  notes TEXT NULL,
  UNIQUE KEY uq_source_coordinate (price_list_id, source_sheet, source_row_number),
  KEY idx_source_status (row_status),
  KEY idx_source_title (title_candidate(191)),
  CONSTRAINT fk_source_price_list FOREIGN KEY (price_list_id) REFERENCES price_lists(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",
"""CREATE TABLE IF NOT EXISTS products (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  source_row_id BIGINT UNSIGNED NOT NULL,
  article VARCHAR(255) NULL,
  article_raw VARCHAR(255) NULL,
  brand VARCHAR(255) NULL,
  brand_id BIGINT UNSIGNED NULL,
  brand_match_method VARCHAR(64) NULL,
  name TEXT NOT NULL,
  type VARCHAR(40) NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'other',
  defects_json LONGTEXT NULL,
  volume_ml DECIMAL(10,3) NULL,
  volume_text VARCHAR(80) NULL,
  display_kind VARCHAR(20) NULL,
  size_width DECIMAL(10,3) NULL,
  size_height DECIMAL(10,3) NULL,
  size_unit ENUM('mm','cm') NULL,
  price_usd DECIMAL(12,4) NULL,
  price_raw VARCHAR(255) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  gender ENUM('M','F','U') NULL,
  gender_from_name VARCHAR(255) NULL,
  is_tester TINYINT(1) NOT NULL DEFAULT 0,
  is_sample TINYINT(1) NOT NULL DEFAULT 0,
  is_set TINYINT(1) NOT NULL DEFAULT 0,
  set_component_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  extra_info_json LONGTEXT NULL,
  raw_title TEXT NOT NULL,
  raw_cells_json LONGTEXT NOT NULL,
  source_file VARCHAR(255) NOT NULL,
  source_sheet VARCHAR(255) NOT NULL,
  source_row_number INT UNSIGNED NOT NULL,
  parse_confidence DECIMAL(4,3) NOT NULL DEFAULT 0,
  needs_review TINYINT(1) NOT NULL DEFAULT 0,
  review_reasons_json LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_products_brand (brand),
  KEY idx_products_name (name(191)),
  KEY idx_products_article (article),
  KEY idx_products_type (type),
  KEY idx_products_gender (gender),
  KEY idx_products_price (price_usd),
  KEY idx_products_set (is_set),
  KEY idx_products_review (needs_review),
  KEY idx_products_source_row (source_row_id),
  CONSTRAINT fk_product_source_row FOREIGN KEY (source_row_id) REFERENCES source_rows(id),
  CONSTRAINT fk_product_brand FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",
"""CREATE TABLE IF NOT EXISTS product_components (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  parent_product_id BIGINT UNSIGNED NOT NULL,
  sequence_no SMALLINT UNSIGNED NOT NULL,
  brand VARCHAR(255) NULL,
  name TEXT NOT NULL,
  type VARCHAR(40) NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'other',
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
  volume_ml DECIMAL(10,3) NULL,
  volume_text VARCHAR(80) NULL,
  gender ENUM('M','F','U') NULL,
  raw_component TEXT NOT NULL,
  needs_review TINYINT(1) NOT NULL DEFAULT 0,
  review_reasons_json LONGTEXT NULL,
  UNIQUE KEY uq_component_order (parent_product_id, sequence_no),
  KEY idx_component_brand (brand),
  KEY idx_component_type (type),
  CONSTRAINT fk_component_parent FOREIGN KEY (parent_product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",
"""CREATE TABLE IF NOT EXISTS product_defects (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  product_id BIGINT UNSIGNED NOT NULL,
  defect_code VARCHAR(40) NOT NULL,
  UNIQUE KEY uq_product_defect (product_id, defect_code),
  CONSTRAINT fk_defect_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",
]


def _sql_json(value: Any) -> Optional[str]:
    if value is None: return None
    return json.dumps(value, ensure_ascii=False, separators=(",",":"), default=str)


def _insert_batches(table: str, columns: list[str], rows: list[tuple[Any,...]], batch_size: int = 150) -> str:
    if not rows: return ""
    out=[]; colsql=", ".join(f"`{c}`" for c in columns)
    for start in range(0,len(rows),batch_size):
        chunk=rows[start:start+batch_size]
        vals=",\n".join("("+", ".join(sql_quote(v) for v in row)+")" for row in chunk)
        out.append(f"INSERT INTO `{table}` ({colsql}) VALUES\n{vals};\n")
    return "\n".join(out)


def generate_sql_dump(data: dict[str,Any], index: BrandIndex, out_path: Path, database_name: str="perfume_catalog") -> None:
    brand_ids={b["name"]:i for i,b in enumerate(index.brands,1)}
    brand_id_norm={normalize_brand(b["name"]):i for i,b in enumerate(index.brands,1)}
    alias_rows=[]
    for i,a in enumerate(index.alias_rows,1):
        alias_rows.append((i,a["alias"],a["normalized_alias"],a["canonical"],brand_id_norm.get(normalize_brand(a["canonical"])),a.get("source"),a.get("confidence"),a.get("ambiguous",0)))
    brand_rows=[]
    for i,b in enumerate(index.brands,1):
        brand_rows.append((i,b["name"],b.get("normalized_name") or normalize_brand(b["name"]),_sql_json(b.get("sources",[])),_sql_json(b.get("aliases",[]))))
    pl_rows=[(p["id"],p["filename"],p["supplier_name"],p["imported_at"],p["parser_version"]) for p in data["price_lists"]]
    sr_rows=[]
    for r in data["source_rows"]:
        sr_rows.append((r["id"],r["price_list_id"],r["source_file"],r["source_sheet"],r["source_row_number"],r["row_status"],r["title_candidate"],r["raw_price"],_sql_json(r["column_roles"]),_sql_json(r["raw_cells"]),r["product_id"],r["notes"]))
    product_rows=[]; defect_rows=[]; defect_id=1
    for p in data["products"]:
        brand_id=brand_id_norm.get(normalize_brand(p["brand"])) if p.get("brand") else None
        product_rows.append((p["id"],p["source_row_id"],p["article"],p["article_raw"],p["brand"],brand_id,p["brand_match_method"],p["name"],p["type"],p["category"],_sql_json(p["defects"]),p["volume_ml"],p["volume_text"],p.get("display_kind"),p.get("size_width"),p.get("size_height"),p.get("size_unit"),p["price_usd"],p["price_raw"],p["currency"],p["gender"],p["gender_from_name"],p["is_tester"],p["is_sample"],p["is_set"],p["set_component_count"],_sql_json(p["extra_info"]),p["raw_title"],_sql_json(p["raw_cells"]),p["source_file"],p["source_sheet"],p["source_row_number"],p["parse_confidence"],p["needs_review"],_sql_json(p["review_reasons"])))
        for defect in p["defects"]:
            defect_rows.append((defect_id,p["id"],defect)); defect_id+=1
    component_rows=[]
    for i,c in enumerate(data["components"],1):
        component_rows.append((i,c["parent_product_id"],c["sequence_no"],c["brand"],c["name"],c["type"],c["category"],c.get("quantity",1),c["volume_ml"],c["volume_text"],c["gender"],c["raw_component"],c.get("needs_review",0),_sql_json(c.get("review_reasons",[]))))
    content=["-- Perfume & cosmetics catalog import; generated by sort_import.py " + PARSER_VERSION,
             "-- All physical source rows are retained in source_rows; ambiguous parses require review.",
             "SET NAMES utf8mb4;", "SET FOREIGN_KEY_CHECKS=0;",
             f"CREATE DATABASE IF NOT EXISTS `{database_name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;",
             f"USE `{database_name}`;", ""]
    content.extend(stmt+";" if not stmt.rstrip().endswith(";") else stmt for stmt in SCHEMA_STATEMENTS)
    content.append("\n-- 1) Canonical brand dictionary")
    content.append(_insert_batches("brands",["id","name","normalized_name","sources_json","aliases_json"],brand_rows))
    content.append("\n-- 2) Brand aliases and variants")
    content.append(_insert_batches("brand_aliases",["id","alias","normalized_alias","canonical_brand","brand_id","source","confidence","ambiguous"],alias_rows))
    content.append("\n-- 3) Input price lists")
    content.append(_insert_batches("price_lists",["id","filename","supplier_name","imported_at","parser_version"],pl_rows))
    content.append("\n-- 4) Every physical row, including blank/header/meta rows")
    content.append(_insert_batches("source_rows",["id","price_list_id","source_file","source_sheet","source_row_number","row_status","title_candidate","raw_price","column_roles_json","raw_cells_json","product_id","notes"],sr_rows))
    content.append("\n-- 5) Parsed parent/products")
    pcols=["id","source_row_id","article","article_raw","brand","brand_id","brand_match_method","name","type","category","defects_json","volume_ml","volume_text","display_kind","size_width","size_height","size_unit","price_usd","price_raw","currency","gender","gender_from_name","is_tester","is_sample","is_set","set_component_count","extra_info_json","raw_title","raw_cells_json","source_file","source_sheet","source_row_number","parse_confidence","needs_review","review_reasons_json"]
    content.append(_insert_batches("products",pcols,product_rows))
    content.append("\n-- 6) Set contents/components")
    ccols=["id","parent_product_id","sequence_no","brand","name","type","category","quantity","volume_ml","volume_text","gender","raw_component","needs_review","review_reasons_json"]
    content.append(_insert_batches("product_components",ccols,component_rows))
    content.append("\n-- 7) Normalized defect flags")
    content.append(_insert_batches("product_defects",["id","product_id","defect_code"],defect_rows))
    content.extend(["SET FOREIGN_KEY_CHECKS=1;", ""])
    out_path.parent.mkdir(parents=True,exist_ok=True)
    out_path.write_text("\n".join(content),encoding="utf-8")


def _csv_cell(v: Any) -> Any:
    if isinstance(v,(dict,list,tuple)): return json.dumps(v,ensure_ascii=False,default=str)
    return v


def write_csv(path: Path, rows: list[dict[str,Any]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open("w",encoding="utf-8-sig",newline="") as f:
        w=csv.DictWriter(f,fieldnames=fieldnames,extrasaction="ignore")
        w.writeheader()
        for row in rows: w.writerow({k:_csv_cell(row.get(k)) for k in fieldnames})


def write_reports(data: dict[str,Any], out_dir: Path, sql_path: Path) -> dict[str,str]:
    out_dir.mkdir(parents=True,exist_ok=True)
    products=data["products"]
    components=data["components"]
    source_rows=data["source_rows"]
    product_fields=["id","source_row_id","source_file","source_sheet","source_row_number","article","brand","name","type","category","defects","volume_ml","volume_text","display_kind","size_width","size_height","size_unit","price_usd","price_raw","currency","gender","gender_from_name","is_tester","is_sample","is_set","set_component_count","extra_info","parse_confidence","needs_review","review_reasons","raw_title"]
    review_fields=["id","source_file","source_sheet","source_row_number","article","brand","name","type","category","volume_ml","volume_text","display_kind","size_width","size_height","size_unit","price_usd","price_raw","gender","gender_from_name","is_tester","is_set","set_component_count","review_reasons","raw_title","raw_cells"]
    source_fields=["id","price_list_id","source_file","source_sheet","source_row_number","row_status","title_candidate","raw_price","column_roles","product_id","notes","raw_cells"]
    component_fields=["id","parent_product_id","sequence_no","brand","name","type","category","quantity","volume_ml","volume_text","gender","raw_component","needs_review","review_reasons"]
    files={}
    write_csv(out_dir/"parsed_products.csv",products,product_fields);files["products_csv"]=str(out_dir/"parsed_products.csv")
    reviews=[p for p in products if p["needs_review"]]
    write_csv(out_dir/"review_rows.csv",reviews,review_fields);files["review_csv"]=str(out_dir/"review_rows.csv")
    write_csv(out_dir/"source_row_audit.csv",source_rows,source_fields);files["source_audit_csv"]=str(out_dir/"source_row_audit.csv")
    write_csv(out_dir/"set_components.csv",components,component_fields);files["components_csv"]=str(out_dir/"set_components.csv")

    # Always rewrite optional diagnostics so old results cannot survive a clean rerun.
    price_anomalies=[]
    unmatched_brands=[]
    for p in products:
        reasons=p.get("review_reasons") or []
        if "price_out_of_expected_range_not_imported_as_numeric" in reasons:
            price_anomalies.append({"file":p.get("source_file"),"sheet":p.get("source_sheet"),
                "row":p.get("source_row_number"),"raw_title":p.get("raw_title"),"brand":p.get("brand"),
                "name":p.get("name"),"price_raw":p.get("price_raw"),"price_usd":p.get("price_usd"),
                "reasons":reasons})
        if any("brand_not_matched_to_dictionary" in str(reason) or "ambiguous_brand" in str(reason) for reason in reasons):
            unmatched_brands.append({"file":p.get("source_file"),"sheet":p.get("source_sheet"),
                "row":p.get("source_row_number"),"raw_title":p.get("raw_title"),"brand":p.get("brand"),
                "name":p.get("name"),"article":p.get("article"),"price_raw":p.get("price_raw"),
                "reasons":reasons})
    anomaly_fields=["file","sheet","row","raw_title","brand","name","price_raw","price_usd","reasons"]
    write_csv(out_dir/"price_anomalies.csv",price_anomalies,anomaly_fields)
    files["price_anomalies_csv"]=str(out_dir/"price_anomalies.csv")
    (out_dir/"unmatched_brands.json").write_text(json.dumps(unmatched_brands,ensure_ascii=False,indent=2),encoding="utf-8")
    files["unmatched_brands_json"]=str(out_dir/"unmatched_brands.json")

    component_by_parent=defaultdict(list)
    for c in components: component_by_parent[c.get("parent_product_id")].append(c)
    set_parents=[]
    for p in products:
        if p.get("is_set"):
            children=component_by_parent.get(p.get("id"),[])
            set_parents.append({"product_id":p.get("id"),"source_file":p.get("source_file"),
                "source_sheet":p.get("source_sheet"),"source_row_number":p.get("source_row_number"),
                "article":p.get("article"),"brand":p.get("brand"),"name":p.get("name"),
                "price_usd":p.get("price_usd"),"price_raw":p.get("price_raw"),
                "set_component_count":len(children),"components":children,"raw_title":p.get("raw_title"),
                "needs_review":p.get("needs_review"),"review_reasons":p.get("review_reasons")})
    set_parent_fields=["product_id","source_file","source_sheet","source_row_number","article","brand","name",
        "price_usd","price_raw","set_component_count","components","raw_title","needs_review","review_reasons"]
    write_csv(out_dir/"set_parent_audit.csv",set_parents,set_parent_fields)
    files["set_parent_audit_csv"]=str(out_dir/"set_parent_audit.csv")

    reason_counts=Counter(str(reason) for p in products for reason in (p.get("review_reasons") or []))
    (out_dir/"review_reason_counts.json").write_text(json.dumps(dict(reason_counts.most_common()),ensure_ascii=False,indent=2),encoding="utf-8")
    files["review_reason_counts_json"]=str(out_dir/"review_reason_counts.json")
    # JSON Lines makes it straightforward to inspect/import parsed records without SQL.
    with (out_dir/"parsed_products.jsonl").open("w",encoding="utf-8") as f:
        for row in products: f.write(json.dumps(row,ensure_ascii=False,default=str)+"\n")
    files["products_jsonl"]=str(out_dir/"parsed_products.jsonl")
    audit={"parser_version":PARSER_VERSION,"generated_at":datetime.now().astimezone().isoformat(timespec="seconds"),
           "sql_dump":str(sql_path),"stats":data["stats"],"review_sample":[
               {k:p.get(k) for k in ("source_file","source_sheet","source_row_number","raw_title","brand","name","price_raw","review_reasons")}
               for p in products if p["needs_review"]][:100]}
    (out_dir/"import_audit.json").write_text(json.dumps(audit,ensure_ascii=False,indent=2,default=str),encoding="utf-8")
    files["audit_json"]=str(out_dir/"import_audit.json")
    # Text instructions are copied separately in the package as well.
    return files


def _split_sql_statements(sql_text: str) -> Iterable[str]:
    """Split generated SQL on semicolons outside quoted strings/comments."""
    buf=[]; i=0; quote=None; line_comment=False; block_comment=False
    while i<len(sql_text):
        ch=sql_text[i]; nxt=sql_text[i+1] if i+1<len(sql_text) else ""
        if line_comment:
            if ch=="\n": line_comment=False; buf.append("\n")
            i+=1; continue
        if block_comment:
            if ch=="*" and nxt=="/": block_comment=False; i+=2
            else:i+=1
            continue
        if quote:
            buf.append(ch)
            if ch=="\\" and i+1<len(sql_text): buf.append(sql_text[i+1]);i+=2;continue
            if ch==quote:
                if nxt==quote: buf.append(nxt);i+=2;continue
                quote=None
            i+=1;continue
        if ch=="-" and nxt=="-" and (i==0 or sql_text[i-1] in " \t\r\n"):
            line_comment=True;i+=2;continue
        if ch=="/" and nxt=="*":block_comment=True;i+=2;continue
        if ch in ("'",'"','`'):
            quote=ch;buf.append(ch);i+=1;continue
        if ch==";":
            statement="".join(buf).strip();buf=[]
            if statement:yield statement
            i+=1;continue
        buf.append(ch);i+=1
    statement="".join(buf).strip()
    if statement:yield statement


def apply_sql_to_mariadb(sql_path: Path, host: str, port: int, user: str, password: str, database: str) -> None:
    try:
        import pymysql  # type: ignore
    except ImportError as e:
        raise RuntimeError("Для прямой записи в MariaDB установите PyMySQL: pip install PyMySQL") from e
    if not re.fullmatch(r"[A-Za-z0-9_]+",database): raise ValueError("Имя базы может содержать только латинские буквы, цифры и _")
    conn=pymysql.connect(host=host,port=port,user=user,password=password,database=database,charset="utf8mb4",autocommit=False,connect_timeout=15)
    try:
        with conn.cursor() as cur:
            total=0
            for statement in _split_sql_statements(sql_path.read_text(encoding="utf-8")):
                # Direct mode connects to an already-created target database. Ignore the
                # dump's CREATE DATABASE/USE so --mysql-database is authoritative.
                normalized_statement = statement.lstrip().upper()
                if normalized_statement.startswith("CREATE DATABASE ") or normalized_statement.startswith("USE "):
                    continue
                cur.execute(statement); total+=1
                if total%100==0: conn.commit();print(f"[DB] Выполнено SQL-операторов: {total}")
        conn.commit()
        print(f"[DB] Завершено: выполнено SQL-операторов {total} в БД {database}.")
    except Exception:
        conn.rollback()
        raise
    finally: conn.close()


def gather_input_files(paths: list[str]) -> list[Path]:
    out=[]; allowed={".xls",".xlsx",".xlsm",".csv",".tsv",".txt"}
    for item in paths:
        p=Path(item)
        if not p.exists(): raise FileNotFoundError(f"Файл или каталог не найден: {p}")
        if p.is_dir(): out.extend(sorted(x for x in p.iterdir() if x.is_file() and x.suffix.casefold() in allowed))
        elif p.suffix.casefold() in allowed: out.append(p)
        else: raise ValueError(f"Неподдерживаемый файл: {p}")
    # Prevent accidental double parsing of the same exact file.
    unique=[]; seen=set()
    for p in out:
        key=str(p.resolve())
        if key not in seen: seen.add(key);unique.append(p)
    return unique


def load_preextracted_rows(path: Path) -> list[tuple[str,str,list[list[Any]]]]:
    grouped=defaultdict(list)
    with path.open("r",encoding="utf-8") as f:
        for line_no,line in enumerate(f,1):
            if not line.strip(): continue
            try: item=json.loads(line)
            except json.JSONDecodeError as e: raise ValueError(f"JSONL ошибка в строке {line_no}: {e}")
            key=(str(item.get("file","source.jsonl")),str(item.get("sheet","Sheet1")))
            grouped[key].append((int(item.get("row_num",len(grouped[key])+1)),item.get("cells",[])))
    return [(file,sheet,[cells for _n,cells in sorted(rows,key=lambda x:x[0])]) for (file,sheet),rows in grouped.items()]


def main() -> int:
    ap=argparse.ArgumentParser(description="Универсальный разбор прайс-листов парфюмерии/косметики в MariaDB.")
    ap.add_argument("paths",nargs="*",help="Файлы .xls/.xlsx/.csv/.tsv или папки")
    ap.add_argument("--rows-jsonl",help="Внутренний/внешний предварительно извлечённый JSONL с {file,sheet,row_num,cells}")
    ap.add_argument("--brands",default=None,help="brands_all.json")
    ap.add_argument("--brand-aliases",default=None,help="brand_aliases.json")
    ap.add_argument("--rules",default=None,help="parser_rules.json")
    ap.add_argument("--set-rules",default=None,help="set_patterns.json")
    ap.add_argument("--out-dir",default="sort_output",help="Папка для CSV/JSON отчётов")
    ap.add_argument("--out-sql",default="perfume_catalog.sql",help="Путь к MariaDB SQL дампу")
    ap.add_argument("--database-name",default="perfume_catalog",help="Имя базы в SQL дампе")
    ap.add_argument("--mysql-host",default=None,help="При задании напрямую выполнить SQL дамп в MariaDB/MySQL")
    ap.add_argument("--mysql-port",type=int,default=3306)
    ap.add_argument("--mysql-user",default="root")
    ap.add_argument("--mysql-password",default="")
    ap.add_argument("--mysql-database",default=None,help="База уже должна существовать; по умолчанию --database-name")
    args=ap.parse_args()

    base=Path(__file__).resolve().parent
    brands_path=Path(args.brands) if args.brands else base/"brands_all.json"
    aliases_path=Path(args.brand_aliases) if args.brand_aliases else base/"brand_aliases.json"
    rules_path=Path(args.rules) if args.rules else base/"parser_rules.json"
    set_rules_path=Path(args.set_rules) if args.set_rules else base/"set_patterns.json"
    for required in (brands_path,aliases_path,rules_path,set_rules_path):
        if not required.exists(): raise FileNotFoundError(f"Не найден справочник: {required}")
    if args.rows_jsonl:
        workbooks=load_preextracted_rows(Path(args.rows_jsonl))
    else:
        files=gather_input_files(args.paths)
        if not files: ap.error("Укажите хотя бы один входной файл/каталог или --rows-jsonl")
        workbooks=[]
        for path in files:
            print(f"[READ] {path}")
            for sheet,matrix in read_workbook(path):
                workbooks.append((path.name,sheet,matrix))
    rules=load_json(rules_path,{})
    set_rules=load_json(set_rules_path,{})
    index=build_brand_index(brands_path,aliases_path)
    print(f"[INFO] Брендов загружено: {len(index.brands)}; aliases: {len(index.alias_rows)}; листов к разбору: {len(workbooks)}")
    data=process_workbook_rows(workbooks,rules,set_rules,index)
    sql_path=Path(args.out_sql).resolve()
    generate_sql_dump(data,index,sql_path,args.database_name)
    report_paths=write_reports(data,Path(args.out_dir).resolve(),sql_path)
    stats=data["stats"]
    print("\n=== ИТОГИ ===")
    print(f"Физических строк в аудите: {stats['totals']['source_rows']}")
    print(f"Строк, классифицированных как товары: {stats['totals']['products']}")
    print(f"Наборов: {stats['totals']['sets']}; компонентов наборов: {stats['totals']['components']}")
    print(f"Товары на ручную проверку: {stats['totals']['review_products']}")
    print(f"SQL дамп: {sql_path} ({sql_path.stat().st_size:,} bytes)")
    print(f"Отчёты: {Path(args.out_dir).resolve()}")
    print("Статусы строк:",json.dumps(stats["status_counts"],ensure_ascii=False))
    if args.mysql_host:
        apply_sql_to_mariadb(sql_path,args.mysql_host,args.mysql_port,args.mysql_user,args.mysql_password,args.mysql_database or args.database_name)
    return 0

if __name__=="__main__":
    raise SystemExit(main())
