"""Regression tests for responsibility-based Python and SQL package layout."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def test_common_and_services_roots_only_hold_package_init_files():
    for rel in ("bot/handlers/common", "bot/services"):
        directory = ROOT / rel
        unexpected = sorted(path.name for path in directory.glob("*.py") if path.name != "__init__.py")
        assert not unexpected, f"{rel} must keep implementations inside topic packages: {unexpected}"
        assert (directory / "__init__.py").is_file()

def test_requested_common_modules_are_nested_in_packages():
    expected = [
        "bot/handlers/common/admin/access.py",
        "bot/handlers/common/deps/base.py",
        "bot/handlers/common/middleware/guards.py",
        "bot/handlers/common/middleware/keyboard.py",
        "bot/handlers/common/notifications/ephemeral.py",
        "bot/handlers/common/runtime/context.py",
        "bot/handlers/common/states/activation.py",
    ]
    for rel in expected:
        path = ROOT / rel
        assert path.is_file(), rel
        assert (path.parent / "__init__.py").is_file(), f"Missing package initializer for {rel}"

def test_requested_services_are_nested_in_packages():
    expected = [
        "bot/services/queues/announcement_queue.py",
        "bot/services/queues/user_deletion_queue.py",
        "bot/services/files/file_names.py",
        "bot/services/notifications/telegram.py",
    ]
    for rel in expected:
        path = ROOT / rel
        assert path.is_file(), rel
        assert (path.parent / "__init__.py").is_file(), f"Missing package initializer for {rel}"

def test_dumps_only_contain_the_two_supported_full_install_variants():
    dumps = ROOT / "bot/database/dumps"
    assert sorted(path.name for path in dumps.glob("*.sql")) == [
        "14_full_install_empty_brands.sql", "15_full_install_with_brands.sql"
    ]
    assert (ROOT / "bot/database/seeds/02_full_demo.sql").is_file()
    assert (ROOT / "bot/database/migrations/07_persistent_bot_menu.sql").is_file()
    assert (ROOT / "bot/database/legacy/00_full_install.sql").is_file()
