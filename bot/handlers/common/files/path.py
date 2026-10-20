from bot.handlers.common.deps import *
from bot.handlers.common.runtime import *

def safe_data_file_path(filepath: str | None) -> Path | None:
    if not filepath:
        return None
    try:
        path = Path(filepath).resolve()
        root = settings.data_dir.resolve()
        if path.is_file() and path.is_relative_to(root):
            return path
    except (OSError, ValueError):
        log.exception("Could not validate a stored price-list path")
    return None
