from migrate_database import _column_definitions, _compatible_type, config_from_env, quote_ident, load_php_db_config
from pathlib import Path
import tempfile


def test_quote_ident_escapes_backticks():
    assert quote_ident("odd`name") == "`odd``name`"


def test_column_definitions_extracts_only_columns():
    sql = """CREATE TABLE `demo` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(180) DEFAULT NULL,
  `state` enum('a','b') NOT NULL DEFAULT 'a',
  PRIMARY KEY (`id`),
  KEY `idx_title` (`title`)
) ENGINE=InnoDB"""
    found = _column_definitions(sql)
    assert set(found) == {"id", "title", "state"}
    assert "AUTO_INCREMENT" in found["id"]


def test_type_compatibility_accepts_safe_widening():
    assert _compatible_type("varchar(50)", "varchar(100)")
    assert _compatible_type("int", "bigint")
    assert _compatible_type("enum('a','b')", "enum('a','b','c')")
    assert not _compatible_type("varchar(200)", "varchar(100)")
    assert not _compatible_type("enum('a','c')", "enum('a','b')")


def test_php_config_parser_reads_literals():
    php = """<?php
    define('DB_HOST', 'db.example.test');
    define('DB_PORT', '3307');
    $db_user = 'app_user';
    $db_password = 'secret-do-not-print';
    return ['database' => 'app_db'];
    """
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "database.php"
        path.write_text(php, encoding="utf-8")
        cfg = load_php_db_config(path)
    assert cfg["host"] == "db.example.test"
    assert cfg["port"] == 3307
    assert cfg["user"] == "app_user"
    assert cfg["password"] == "secret-do-not-print"
    assert cfg["database"] == "app_db"
