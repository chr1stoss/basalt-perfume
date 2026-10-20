from pathlib import Path
from PIL import Image
import ast

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "bot" / "assets"
source = (ROOT / "bot" / "handlers" / "common" / "runtime.py").read_text(encoding="utf-8")
tree = ast.parse(source)
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "image_for")
module = ast.Module(body=[function], type_ignores=[])
exec(compile(module, "runtime.py", "exec"), {"Path": Path, "ASSETS": ASSETS})
image_for = locals().get("image_for")
if image_for is None:
    namespace = {"Path": Path, "ASSETS": ASSETS}
    exec(compile(module, "runtime.py", "exec"), namespace)
    image_for = namespace["image_for"]


def test_asset_folders_have_expected_images_only():
    assert sorted(p.name for p in (ASSETS / "none").iterdir()) == ["description_pic.png", "logo.jpg"]
    expected = ["activation.jpg", "how_upload.jpg", "main.jpg"]
    for locale in ("ru", "en"):
        assert sorted(p.name for p in (ASSETS / locale).iterdir()) == expected
        for name in expected:
            with Image.open(ASSETS / locale / name) as image:
                image.verify()


def test_localized_image_selection_ru_en_and_kz():
    assert image_for("ru", "main") == ASSETS / "ru" / "main.jpg"
    assert image_for("en", "main") == ASSETS / "en" / "main.jpg"
    assert image_for("kz", "main") == ASSETS / "ru" / "main.jpg"
    assert image_for("KZ", "activation") == ASSETS / "ru" / "activation.jpg"
    assert image_for("en-US", "upload") == ASSETS / "en" / "how_upload.jpg"
    assert image_for(None, "upload") == ASSETS / "ru" / "how_upload.jpg"
