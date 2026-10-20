import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# The bot and WebApp are supplied as separate projects. When both project folders
# are unpacked beside each other, expose the WebApp at the legacy test path used
# by the existing contract tests without duplicating production files.
LEGACY_SITE = ROOT / "htdocs"
_os = __import__("os")
_php_root_override = _os.environ.get("PHP_WEBAPP_ROOT")
if _php_root_override:
    _php_candidates = [Path(_php_root_override).resolve()]
else:
    _php_candidates = [
        (ROOT.parent / "basalt-parfume-php").resolve(),
        (ROOT.parent / "php" / "basalt-parfume-php").resolve(),
        (ROOT.parent.parent / "php" / "basalt-parfume-php").resolve(),
    ]
SIBLING_SITE = next((candidate for candidate in _php_candidates if candidate.is_dir()), _php_candidates[0])
if not LEGACY_SITE.exists() and SIBLING_SITE.is_dir():
    try:
        LEGACY_SITE.symlink_to(SIBLING_SITE, target_is_directory=True)
    except OSError:
        # Read-only environments can still run bot-only tests; site-contract tests
        # require the WebApp source to be supplied separately.
        pass
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
