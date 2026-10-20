from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *

async def replace_existing_named_files(
    tg_id: int,
    names: set[str],
    new_items: list[dict],
    extra_old_paths: set[str] | dict[str, set[str]] | None = None,
    extra_old_ids: set[int] | dict[str, set[int]] | None = None,
):
    """Commit replacement only for successfully parsed items.

    The new files have already been parsed and inserted. We now remove matching old
    records and rename the successful new rows to their original names in one DB
    transaction. If parsing failed, this function is never called for that item, so
    the old catalogue entry stays available.
    """
    if not names or not new_items:
        return
    wanted = {normalize_filename(name) for name in names if normalize_filename(name)}
    candidate_by_norm: dict[str, dict] = {}
    for item in new_items:
        norm = normalize_filename(item.get("filename"))
        if norm in wanted and item.get("path"):
            candidate_by_norm.setdefault(norm, item)
    if not candidate_by_norm:
        return

    root = settings.data_dir.resolve()
    # Every successfully processed candidate must survive the cleanup, not only the
    # first item with each normalized name. A Telegram album can legitimately contain
    # two documents with the same filename; parser-side suffixes make those rows unique.
    candidate_paths = {
        str(Path(item["path"]).resolve())
        for item in new_items
        if item.get("path")
    }
    removed_paths: set[str] = set()
    try:
        async with pool().acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id,filename,filepath FROM price_lists WHERE owner_tg_id=%s FOR UPDATE",
                    (int(tg_id),),
                )
                rows = await cur.fetchall()
                by_path = {}
                for row_id, filename, filepath in rows:
                    if filepath:
                        try:
                            resolved = str(Path(filepath).resolve())
                            if Path(resolved).is_relative_to(root):
                                by_path[resolved] = (int(row_id), str(filename), resolved)
                        except (OSError, ValueError):
                            log.warning("Ignored unsafe price-list path during replacement: %r", filepath)

                replacements: list[tuple[int, str, str]] = []
                old_ids: set[int] = set()
                for norm, item in candidate_by_norm.items():
                    candidate_path = str(Path(item["path"]).resolve())
                    new_row = by_path.get(candidate_path)
                    if not new_row:
                        log.error(
                            "Refusing to remove old price list: successfully processed file has no DB row "
                            "tg_id=%s filename=%r path=%s",
                            tg_id, item.get("filename"), candidate_path,
                        )
                        continue
                    new_id = new_row[0]
                    target_name = Path(str(item.get("filename") or new_row[1])).name[:230]
                    candidate_row_ids = {
                        int(row_id) for row_id, _filename, filepath in rows
                        if filepath and str(Path(filepath).resolve()) in candidate_paths
                    }
                    if isinstance(extra_old_ids, dict):
                        norm_extra_ids = {int(value) for value in extra_old_ids.get(norm, set())}
                    else:
                        # Backward compatibility for older call sites that pass a flat set.
                        norm_extra_ids = {int(value) for value in (extra_old_ids or set())}
                    for row_id, filename, filepath in rows:
                        if int(row_id) in candidate_row_ids:
                            continue
                        if normalize_filename(filename) != norm and int(row_id) not in norm_extra_ids:
                            continue
                        old_ids.add(int(row_id))
                        if filepath:
                            try:
                                old_path = Path(filepath).resolve()
                                if old_path.is_relative_to(root) and str(old_path) not in candidate_paths:
                                    removed_paths.add(str(old_path))
                            except (OSError, ValueError):
                                log.warning("Ignored unsafe old file path during replacement: %r", filepath)
                    replacements.append((new_id, target_name, norm))

                if not replacements:
                    return
                replaced_norms = {norm for _new_id, _target_name, norm in replacements}
                # Delete first to satisfy uq_price_lists_owner_filename, then rename the
                # new successful rows. Cascading FKs remove only old products/source rows.
                for old_id in old_ids:
                    await cur.execute(
                        "DELETE FROM price_lists WHERE id=%s AND owner_tg_id=%s",
                        (old_id, int(tg_id)),
                    )
                for new_id, target_name, _norm in replacements:
                    await cur.execute(
                        "UPDATE price_lists SET filename=%s WHERE id=%s AND owner_tg_id=%s",
                        (target_name, new_id, int(tg_id)),
                    )
            await conn.commit()
    except Exception:
        log.exception("Post-processing replacement transaction failed tg_id=%s names=%s", tg_id, sorted(wanted))
        raise

    # Remove confirmed legacy files stored directly in data/ or data/excel/.
    # When supplied as a dict, old paths are tied to the incoming normalized name,
    # so an unrelated failed replacement cannot clean another file.
    if isinstance(extra_old_paths, dict):
        paths_by_norm = {str(norm): set(paths or set()) for norm, paths in extra_old_paths.items() if str(norm) in replaced_norms}
        path_items = [(norm, raw_path) for norm, paths in paths_by_norm.items() for raw_path in paths]
    else:
        path_items = [(None, raw_path) for raw_path in (extra_old_paths or set())]
    for norm, raw_path in path_items:
        try:
            path = Path(raw_path).resolve()
            eligible = norm in replaced_norms if norm is not None else normalize_filename(path.name) in candidate_by_norm
            if path.is_file() and path.is_relative_to(root) and str(path) not in candidate_paths and eligible:
                removed_paths.add(str(path))
        except (OSError, ValueError):
            log.exception("Could not validate a legacy replacement path %r", raw_path)

    # Remove orphaned files that have no DB row as well, but never remove any newly
    # processed candidate. All paths are constrained to DATA_DIR / this user's folder.
    user_root = (root / str(tg_id)).resolve()
    if user_root.is_dir() and user_root.is_relative_to(root):
        try:
            for path in user_root.rglob("*"):
                try:
                    resolved = path.resolve()
                    if (path.is_file() and str(resolved) not in candidate_paths
                            and normalize_filename(path.name) in candidate_by_norm
                            and resolved.is_relative_to(root)):
                        removed_paths.add(str(resolved))
                except (OSError, ValueError):
                    log.exception("Could not inspect file while finalizing replacement path=%s", path)
        except OSError:
            log.exception("Could not scan data folder for orphaned replacement files tg_id=%s", tg_id)
    for raw_path in removed_paths:
        try:
            path = Path(raw_path).resolve()
            if path.is_file() and path.is_relative_to(root) and str(path) not in candidate_paths:
                path.unlink()
        except (OSError, ValueError):
            log.exception("Could not remove replaced old file %s", raw_path)
    log.info("Committed successful file replacements for tg_id=%s: %s", tg_id, sorted(candidate_by_norm))
