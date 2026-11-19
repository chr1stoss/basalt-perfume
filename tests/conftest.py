from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
WORKER_ROOT = ROOT / "private" / "basalt-site-worker"
SORT_ROOT = WORKER_ROOT / "services" / "sort"

for path in (str(WORKER_ROOT), str(SORT_ROOT)):
    if path not in sys.path:
        sys.path.insert(0, path)
