from bot.services.sort.parser_engine import extract_display_dimensions, detect_type
import json
from pathlib import Path


def test_display_dimensions_defaults_to_centimeters_without_units():
    assert extract_display_dimensions("Showcard 60 x 80") == {
        "size_width": 60.0, "size_height": 80.0, "size_unit": "cm", "raw": "60 x 80"
    }


def test_display_dimensions_keeps_explicit_millimeters():
    parsed = extract_display_dimensions("Billboard 600x800 мм")
    assert parsed["size_width"] == 600.0
    assert parsed["size_height"] == 800.0
    assert parsed["size_unit"] == "mm"


def test_display_dimensions_normalizes_meters_to_centimeters():
    parsed = extract_display_dimensions("Display 0.4 x 0.6 m")
    assert parsed["size_width"] == 40.0
    assert parsed["size_height"] == 60.0
    assert parsed["size_unit"] == "cm"


def test_display_dimensions_reads_width_and_height_columns():
    parsed = extract_display_dimensions("", "42,5", "59,4")
    assert parsed["size_width"] == 42.5
    assert parsed["size_height"] == 59.4
    assert parsed["size_unit"] == "cm"


def test_showcard_and_billboard_have_distinct_parser_types():
    rules_path = Path(__file__).resolve().parents[1] / "bot/services/sort/reference/parser_rules.json"
    rules = json.loads(rules_path.read_text(encoding="utf-8"))
    assert detect_type("ACME Showcard 60x80", rules)["canonical"] == "SHOWCARD"
    assert detect_type("ACME Billboard 60x80", rules)["canonical"] == "BILLBOARD"


def test_unlabelled_fractional_dimensions_under_ten_are_inferred_as_meters():
    parsed = extract_display_dimensions("Display 0.4 x 0.6")
    assert parsed["size_width"] == 40.0
    assert parsed["size_height"] == 60.0
    assert parsed["size_unit"] == "cm"
