"""Filename normalization helpers for duplicate detection and replacement flows."""
from pathlib import Path
import re

_PREFIX_TIMESTAMP = re.compile(r"^\d{8}_\d{6}_(?:\d{6}_)?(?:[0-9a-fA-F]{4}_)?")
_SUFFIX_TIMESTAMP = re.compile(r"_\d{8}_\d{6}(?:_\d{6})?$")
_MARKER = re.compile(r"(?:PRICE[ _-]*LIST|PRICELIST|ПРАЙС[ _-]*ЛИСТ)", re.I | re.U)


def normalize_filename(filename: str | None) -> str:
    """Normalize a filename without generated timestamp wrappers.

    In addition to known YYYYMMDD_HHMMSS wrappers, some upload pipelines prefix
    arbitrary ID/timestamp groups before PRICE_LIST/PRICELIST and append date-like
    suffixes. Compare the stable name core, not those generated wrappers.
    """
    name = Path(str(filename or "")).name.strip()
    suffix = Path(name).suffix.casefold()
    stem = name[:-len(Path(name).suffix)] if Path(name).suffix else name
    stem = _PREFIX_TIMESTAMP.sub("", stem, count=1)
    marker = _MARKER.search(stem)
    if marker and marker.start() > 0:
        stem = stem[marker.start():]
    stem = _SUFFIX_TIMESTAMP.sub("", stem, count=1)
    # Strip trailing generated date/time or obvious masked timestamp chunks (e.g. xx_xxxx),
    # but preserve ordinary alphabetic product/brand words.
    stem = re.sub(r"(?:[_-](?:19|20)\d{2}[._-]?\d{2}[._-]?\d{2}){1,2}$", "", stem, flags=re.I)
    stem = re.sub(r"(?:[_-](?:\d{2,14}|[a-z]{1,4})[_-](?:\d{2,14}|[a-z]{1,8}))+$", "", stem, flags=re.I)
    stem = re.sub(r"[_ -]+", "_", stem).strip("_ -").casefold()
    return stem + suffix
