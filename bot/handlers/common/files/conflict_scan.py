from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *
from bot.handlers.common.files.path import safe_data_file_path
from bot.services.file_names import file_content_sha256, filename_similarity, normalize_filename, workbook_semantic_sha256


def _register_conflict(
    conflicts: dict[str, dict],
    candidate: dict,
    existing_name: str,
    existing_path: Path | None,
    row_id: int | None,
    *,
    name_match: bool,
    content_match: bool,
) -> None:
    norm = candidate["norm"]
    entry = conflicts.setdefault(norm, {
        "ids": set(), "paths": set(), "name": Path(existing_name).name,
        "name_match": False, "content_match": False,
    })
    if row_id is not None:
        entry["ids"].add(int(row_id))
    if existing_path is not None:
        try:
            resolved = existing_path.resolve()
            if resolved != candidate["path"]:
                entry["paths"].add(str(resolved))
        except (OSError, ValueError):
            log.debug("Ignoring invalid existing file path while scanning duplicates: %r", existing_path)
    entry["name_match"] = bool(entry["name_match"] or name_match)
    entry["content_match"] = bool(entry["content_match"] or content_match)


def _compare_existing_file(
    conflicts: dict[str, dict], candidates: list[dict], filename: str,
    path: Path | None, row_id: int | None = None,
) -> None:
    """Match an existing row/file by normalized name and/or byte-identical content."""
    existing_norm = normalize_filename(filename)
    resolved_path = None
    file_size = None
    digest = None
    semantic_digest = None
    if path is not None:
        try:
            resolved_path = path.resolve()
            if resolved_path.is_file():
                file_size = resolved_path.stat().st_size
        except (OSError, ValueError):
            resolved_path = None

    # Hash lazily, and only when file size matches an incoming file. Identical bytes
    # necessarily have identical sizes; this avoids reading every stored workbook.
    needs_digest = bool(
        resolved_path is not None
        and file_size is not None
        and any(c["size"] == file_size and c["digest"] for c in candidates)
    )
    if needs_digest:
        digest = file_content_sha256(resolved_path)

    # Workbook packages can be byte-different after an Excel save while preserving
    # every cell value and style. Compare semantic fingerprints for supported files.
    semantic_candidates = [c for c in candidates if Path(c["filename"]).suffix.casefold() == (resolved_path.suffix.casefold() if resolved_path else "")]
    if resolved_path is not None and resolved_path.is_file() and semantic_candidates and resolved_path.suffix.casefold() in {".xlsx", ".xlsm"}:
        semantic_digest = workbook_semantic_sha256(resolved_path)

    for candidate in candidates:
        name_match = bool(existing_norm and existing_norm == candidate["norm"])
        fuzzy_name_match = bool(
            not name_match and filename_similarity(filename, candidate["filename"]) >= 0.93
        )
        content_match = bool(
            digest and candidate["digest"] and file_size == candidate["size"]
            and digest == candidate["digest"]
        )
        semantic_match = bool(
            semantic_digest and candidate.get("semantic_digest")
            and semantic_digest == candidate["semantic_digest"]
        )
        if name_match or fuzzy_name_match or content_match or semantic_match:
            _register_conflict(
                conflicts, candidate, filename, resolved_path, row_id,
                name_match=name_match or fuzzy_name_match, content_match=content_match or semantic_match,
            )


async def get_existing_filename_conflicts(tg_id: int, items: list[dict]) -> dict[str, dict]:
    """Find existing uploads with the same normalized name or identical file bytes.

    Keys remain the incoming file's normalized name so the existing per-file
    confirmation workflow can safely associate a conflict with its upload.
    """
    candidates: list[dict] = []
    candidate_paths: set[Path] = set()
    for item in items:
        raw_path = item.get("path")
        norm = normalize_filename(item.get("filename", ""))
        if not raw_path or not norm:
            continue
        try:
            path = Path(raw_path).resolve()
            if not path.is_file():
                continue
            candidate_paths.add(path)
            candidates.append({
                "norm": norm,
                "filename": Path(str(item.get("filename") or path.name)).name,
                "path": path,
                "size": path.stat().st_size,
                "digest": file_content_sha256(path),
                "semantic_digest": workbook_semantic_sha256(path),
            })
        except (OSError, ValueError):
            log.exception("Could not fingerprint incoming upload for duplicate scan tg_id=%s", tg_id)
    if not candidates:
        return {}

    conflicts: dict[str, dict] = {}
    try:
        async with pool().acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id,filename,filepath FROM price_lists WHERE owner_tg_id=%s", (tg_id,)
                )
                rows = await cur.fetchall()
        for row_id, filename, filepath in rows:
            existing_path = safe_data_file_path(filepath) if filepath else None
            _compare_existing_file(conflicts, candidates, str(filename or ""), existing_path, int(row_id))
    except Exception:
        log.exception("Could not check duplicate price-list names/content in DB for tg_id=%s", tg_id)
        raise

    data_root = settings.data_dir.resolve()
    user_root = (data_root / str(tg_id)).resolve()
    # Legacy locations were used before per-user folders existed. Only scan files
    # directly inside those folders, never another user's private subdirectories.
    scan_roots = (data_root, data_root / "excel")
    for legacy_root in scan_roots:
        try:
            if not legacy_root.is_dir() or not legacy_root.resolve().is_relative_to(data_root):
                continue
            for path in legacy_root.iterdir():
                try:
                    resolved = path.resolve()
                    if not path.is_file() or resolved in candidate_paths:
                        continue
                    _compare_existing_file(conflicts, candidates, path.name, resolved)
                except (OSError, ValueError):
                    log.debug("Could not inspect legacy upload path %r", path, exc_info=True)
        except OSError:
            log.exception("Could not scan legacy data folder for duplicate files tg_id=%s root=%s", tg_id, legacy_root)

    try:
        if user_root.is_dir() and user_root.is_relative_to(data_root):
            for path in user_root.rglob("*"):
                try:
                    resolved = path.resolve()
                    if not path.is_file() or resolved in candidate_paths:
                        continue
                    _compare_existing_file(conflicts, candidates, path.name, resolved)
                except (OSError, ValueError):
                    log.debug("Could not inspect user upload path %r", path, exc_info=True)
    except OSError:
        log.exception("Could not scan user's data directory for duplicate files tg_id=%s", tg_id)
    return conflicts
