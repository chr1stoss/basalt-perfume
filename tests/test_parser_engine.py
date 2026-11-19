import pytest

import parser_engine


@pytest.mark.unit
def test_normalize_text_handles_nbsp_and_repeated_whitespace():
    assert parser_engine.normalize_text("  Dior\u00a0  Homme\n Eau  ") == "Dior Homme Eau"


@pytest.mark.unit
@pytest.mark.parametrize("value", [None, "", "   ", float("nan")])
def test_is_empty(value):
    assert parser_engine.is_empty(value)


@pytest.mark.unit
def test_json_safe_converts_non_finite_float_to_string():
    assert parser_engine.json_safe(float("inf")) == "inf"
    assert parser_engine.json_safe(float("nan")) is None


@pytest.mark.unit
def test_normalize_brand_is_case_and_space_insensitive():
    assert parser_engine.normalize_brand("  DIOR\u00a0 Homme ") == "dior homme"


@pytest.mark.unit
def test_parse_price_supports_russian_decimal_separator():
    assert parser_engine.parse_price("1 234,50") == pytest.approx(1234.5)


@pytest.mark.unit
def test_extract_dimensions_normalizes_units():
    result = parser_engine.extract_display_dimensions("50 x 70 cm")
    assert result["size_width"] == 50
    assert result["size_height"] == 70
    assert result["size_unit"] == "cm"


@pytest.mark.unit
def test_extract_dimensions_converts_metres_to_centimetres():
    result = parser_engine.extract_display_dimensions("1.2 x 2.4 m")
    assert result["size_width"] == 120
    assert result["size_height"] == 240
    assert result["size_unit"] == "cm"

@pytest.mark.unit
def test_to_text_normalizes_integral_float_and_empty_values():
    assert parser_engine.to_text(12.0) == "12"
    assert parser_engine.to_text("  Eau\u00a0 de  Parfum ") == "Eau de Parfum"
    assert parser_engine.to_text(None) is None


@pytest.mark.unit
def test_sql_quote_escapes_string_values_and_handles_null():
    assert parser_engine.sql_quote(None) == "NULL"
    assert parser_engine.sql_quote(True) == "1"
    assert parser_engine.sql_quote("O'Neil") == "'O\\'Neil'"


@pytest.mark.unit
def test_map_header_detects_name_article_and_price_columns():
    result = parser_engine.map_header(["Артикул", "Название товара", "Цена"])
    assert result["article"] == 0
    assert result["name"] == 1
    assert result["price"] == 2


@pytest.mark.unit
def test_detect_header_finds_header_row():
    rows = [
        {"cells": ["Прайс-лист от 16.11"]},
        {"cells": ["Артикул", "Название товара", "Цена"]},
        {"cells": ["001", "Dior Sauvage", "120"]},
    ]
    assert parser_engine.detect_header(rows) == 1


@pytest.mark.unit
def test_read_csv_detects_semicolon_delimiter(tmp_path):
    csv_path = tmp_path / "sample.csv"
    csv_path.write_text("Артикул;Название;Цена\n001;Dior;120,50\n", encoding="utf-8")
    sheets = parser_engine.read_workbook(csv_path)
    assert sheets[0][0] == "sample"
    assert sheets[0][1][1] == ["001", "Dior", "120,50"]


@pytest.mark.unit
def test_read_workbook_rejects_unknown_extension(tmp_path):
    unknown = tmp_path / "sample.pdf"
    unknown.write_bytes(b"not a price list")
    with pytest.raises(ValueError, match="Неподдерживаемый формат"):
        parser_engine.read_workbook(unknown)
