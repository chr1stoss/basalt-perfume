"""Structural checks limited to the Python bot and its own database assets."""
from pathlib import Path
import ast

ROOT = Path(__file__).resolve().parents[1]


def test_feature_implementations_exist_in_topic_packages():
    expected = [
        "bot/handlers/common/admin/access.py",
        "bot/handlers/common/deps/base.py",
        "bot/handlers/common/middleware/guards.py",
        "bot/handlers/common/middleware/keyboard.py",
        "bot/handlers/common/notifications/ephemeral.py",
        "bot/handlers/common/runtime/context.py",
        "bot/handlers/common/states/activation.py",
        "bot/services/queues/announcement_queue.py",
        "bot/services/queues/user_deletion_queue.py",
        "bot/services/files/file_names.py",
        "bot/services/notifications/telegram.py",
    ]
    for relative in expected:
        path = ROOT / relative
        assert path.is_file(), relative
        assert (path.parent / "__init__.py").is_file(), f"Missing __init__.py for {relative}"


def test_expected_bot_services_and_shared_modules_are_nested_in_packages():
    expected = [
        "bot/handlers/common/admin/access.py",
        "bot/handlers/common/deps/base.py",
        "bot/handlers/common/middleware/guards.py",
        "bot/handlers/common/middleware/keyboard.py",
        "bot/handlers/common/notifications/ephemeral.py",
        "bot/handlers/common/runtime/context.py",
        "bot/handlers/common/states/activation.py",
        "bot/services/queues/announcement_queue.py",
        "bot/services/queues/user_deletion_queue.py",
        "bot/services/files/file_names.py",
        "bot/services/notifications/telegram.py",
    ]
    for relative in expected:
        path = ROOT / relative
        assert path.is_file(), relative
        assert (path.parent / "__init__.py").is_file(), f"Missing __init__.py for {relative}"


def test_database_migration_numbering_and_descriptive_readme_are_present():
    migrations = ROOT / "bot/database/migrations"
    sql_files = sorted(path.name for path in migrations.glob("*.sql"))
    assert sql_files
    assert all(path[:2].isdigit() for path in sql_files)
    readme = (migrations / "README.md").read_text(encoding="utf-8")
    assert "Бот не выполняет их автоматически при старте" in readme
    assert "14_full_install_empty_brands.sql" in readme
    assert "15_full_install_with_brands.sql" in readme


def test_every_feature_router_module_is_syntactically_valid_and_registered():
    handlers = ROOT / "bot/handlers"
    feature_root = handlers / "routers"
    root_tree = ast.parse((feature_root / "__init__.py").read_text(encoding="utf-8"))
    imported = set()
    included = set()
    for node in ast.walk(root_tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                if alias.name == "router":
                    imported.add(node.module.lstrip("."))
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "include_router" and node.args and isinstance(node.args[0], ast.Name):
            included.add(node.args[0].id)
    feature_dirs = [p for p in feature_root.iterdir() if p.is_dir() and (p / "__init__.py").is_file()]
    assert feature_dirs
    for feature in feature_dirs:
        assert feature.name in imported
        assert f"{feature.name}_router" in included
        for file in feature.rglob("*.py"):
            ast.parse(file.read_text(encoding="utf-8"), filename=str(file))
