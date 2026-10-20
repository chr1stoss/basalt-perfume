"""Static regression checks for the split handler-router package."""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HANDLERS = ROOT / "bot" / "handlers"
FEATURES = HANDLERS / "routers"


def _tree(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _router_imports(tree: ast.Module) -> set[str]:
    """Return feature/module names imported as router packages."""
    result = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom) or node.module is None:
            continue
        for alias in node.names:
            if alias.name == "router":
                result.add(node.module.lstrip("."))
    return result


def _included_router_names(tree: ast.Module) -> set[str]:
    result = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        if node.func.attr != "include_router" or not node.args:
            continue
        arg = node.args[0]
        if isinstance(arg, ast.Name):
            result.add(arg.id)
    return result


def test_legacy_router_facade_keeps_public_import_path():
    tree = _tree(HANDLERS / "router.py")
    assert "bot.handlers.routers" in _router_imports(tree)
    assert any(
        isinstance(node, ast.ImportFrom)
        and node.module == "bot.handlers.routers"
        and any(alias.name == "router" for alias in node.names)
        for node in tree.body
    )


def test_every_feature_package_registers_its_leaf_routers():
    root_tree = _tree(FEATURES / "__init__.py")
    feature_dirs = sorted(path for path in FEATURES.iterdir() if path.is_dir() and (path / "__init__.py").is_file())
    assert feature_dirs, "Expected feature-router packages"

    root_imports = _router_imports(root_tree)
    root_includes = _included_router_names(root_tree)
    for feature_dir in feature_dirs:
        feature = feature_dir.name
        assert feature in root_imports, f"Root aggregator does not import {feature}"
        assert f"{feature}_router" in root_includes, f"Root aggregator does not include {feature}"

        package_tree = _tree(feature_dir / "__init__.py")
        leaf_modules = {path.stem for path in feature_dir.glob("*.py") if path.name != "__init__.py"}
        imports = _router_imports(package_tree)
        included = _included_router_names(package_tree)
        assert leaf_modules <= imports, f"Missing leaf router imports in {feature}: {leaf_modules - imports}"
        aliases = {
            alias.asname or alias.name
            for node in package_tree.body
            if isinstance(node, ast.ImportFrom)
            for alias in node.names
            if alias.name == "router"
        }
        assert aliases <= included, f"Unregistered leaf routers in {feature}: {aliases - included}"


def test_leaf_router_modules_are_valid_python_and_have_named_definitions():
    for path in FEATURES.rglob("*.py"):
        if path.name == "__init__.py":
            continue
        tree = _tree(path)
        definitions = [
            node for node in tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
        ]
        assert definitions, f"Router module has no top-level function or class: {path.relative_to(ROOT)}"
