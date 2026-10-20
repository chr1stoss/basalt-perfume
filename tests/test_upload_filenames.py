from bot.services.file_names import normalize_filename


def test_filename_comparison_strips_current_leading_timestamp_and_random_token():
    assert normalize_filename("20261013_014437_158343_a1b2_My Price.xlsx") == normalize_filename("My Price.xlsx")


def test_filename_comparison_strips_old_leading_timestamp():
    assert normalize_filename("20261013_014437_My Price.xlsx") == normalize_filename("My Price.xlsx")


def test_filename_comparison_strips_legacy_timestamp_before_extension():
    assert normalize_filename("My Price_20261013_014437.xlsx") == normalize_filename("My Price.xlsx")


def test_filename_comparison_is_case_insensitive_and_uses_basename():
    assert normalize_filename("/tmp/ABC.XLSX") == normalize_filename("abc.xlsx")


def test_timestamp_wrappers_do_not_change_duplicate_filename_core():
    from bot.services.file_names import normalize_filename
    first = "xxxxxxxx_xxxx_xxxx_PRICELIST_CLEOPATRA_xx_xxxx.xlsx"
    second = "yyyyyyyy_yyyy_yyyy_PRICELIST_CLEOPATRA_yy_yyyy.xlsx"
    assert normalize_filename(first) == normalize_filename(second) == "pricelist_cleopatra.xlsx"


def test_duplicate_suffix_after_extension_is_normalized_away():
    first = "PRICELIST CLEOPATRA  20.07.2026.xlsx"
    duplicate = "PRICELIST CLEOPATRA  20.07.2026.xlsx (1)"
    assert normalize_filename(first) == normalize_filename(duplicate)
    assert normalize_filename(first) == "pricelist_cleopatra.xlsx"


def test_duplicate_suffix_before_extension_is_normalized_away():
    first = "PRICELIST CLEOPATRA  20.07.2026.xlsx"
    duplicate = "PRICELIST CLEOPATRA  20.07.2026 (1).xlsx"
    assert normalize_filename(first) == normalize_filename(duplicate)


def test_content_sha256_detects_a_renamed_exact_copy(tmp_path):
    from bot.services.file_names import file_content_sha256

    first = tmp_path / "PRICELIST CLEOPATRA.xlsx"
    duplicate = tmp_path / "PRICELIST CLEOPATRA.xlsx (1)"
    first.write_bytes(b"xlsx-like content with data and style bytes")
    duplicate.write_bytes(first.read_bytes())
    assert file_content_sha256(first) == file_content_sha256(duplicate)


def test_content_sha256_does_not_match_different_bytes(tmp_path):
    from bot.services.file_names import file_content_sha256

    first = tmp_path / "first.xlsx"
    second = tmp_path / "second.xlsx"
    first.write_bytes(b"first workbook")
    second.write_bytes(b"different workbook")
    assert file_content_sha256(first) != file_content_sha256(second)


def test_filename_similarity_flags_near_identical_long_names_only():
    from bot.services.file_names import filename_similarity

    assert filename_similarity(
        "PRICELIST CLEOPATRA 20.07.2026.xlsx",
        "PRICELIST CLEOPATRA 20.07.2026 (1).xlsx",
    ) == 1.0
    assert filename_similarity("short.xlsx", "short2.xlsx") == 0.0


def test_workbook_semantic_fingerprint_ignores_package_metadata(tmp_path):
    from openpyxl import Workbook, load_workbook
    from openpyxl.styles import Font, PatternFill
    from bot.services.file_names import workbook_semantic_sha256

    first = tmp_path / "PRICELIST CLEOPATRA 20.07.2026.xlsx"
    second = tmp_path / "PRICELIST CLEOPATRA 20.07.2026 (1).xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Прайс"
    sheet["A1"] = "Название"
    sheet["B1"] = "Цена"
    sheet["A1"].font = Font(bold=True)
    sheet["A1"].fill = PatternFill(fill_type="solid", fgColor="FFFF00")
    sheet["A2"] = "CLEOPATRA"
    sheet["B2"] = 12.5
    sheet["B2"].number_format = "0.00"
    workbook.save(first)
    workbook.close()

    # Re-save via openpyxl to make a second package; byte hashes may differ, but
    # values, formulas, and formatting should still fingerprint identically.
    workbook = load_workbook(first)
    workbook.properties.creator = "Different package metadata"
    workbook.save(second)
    workbook.close()

    assert workbook_semantic_sha256(first) == workbook_semantic_sha256(second)
