"""Schema, migrations, and seed-file contracts maintained by the bot project."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "bot/database"
DUMPS = (
    DATABASE / "dumps/14_full_install_empty_brands.sql",
    DATABASE / "dumps/15_full_install_with_brands.sql",
)

REQUIRED_COLUMNS = {
    "users": {"tg_id", "username", "first_name", "last_name", "role", "price_multiplier", "is_blocked"},
    "subscription_keys": {"id", "key_hash", "key_prefix", "key_ciphertext", "owner_tg_id", "used_by_tg_id", "duration_days", "role_on_activate", "available_until", "is_frozen"},
    "user_settings": {"tg_id", "language", "theme", "appearance", "notify_updates", "notify_processed_files", "notify_subscription"},
    "price_lists": {"id", "filename", "owner_tg_id", "filepath", "size_bytes", "status", "supplier_name", "imported_at", "parser_version"},
    "source_rows": {"id", "price_list_id", "source_file", "source_sheet", "source_row_number", "row_status", "title_candidate", "raw_price", "column_roles_json", "raw_cells_json", "product_id", "notes"},
    "products": {"id", "source_row_id", "brand", "name", "type", "category", "volume_ml", "volume_text", "price_usd", "price_multiplier", "gender", "is_tester", "is_sample", "is_set", "needs_review", "source_file", "source_sheet", "source_row_number"},
    "product_components": {"id", "parent_product_id", "sequence_no", "brand", "name", "type", "category", "quantity", "volume_ml", "volume_text", "gender", "raw_component"},
    "app_notifications": {"id", "tg_id", "kind", "title", "body", "is_read", "created_at"},
}


def _schema_columns(sql_text: str) -> dict[str, set[str]]:
    tables: dict[str, set[str]] = {}
    create = re.compile(r"CREATE\s+TABLE\s+`?(\w+)`?\s*\((.*?)\)\s*ENGINE\s*=", re.I | re.S)
    for match in create.finditer(sql_text):
        name, body = match.groups()
        columns = set()
        for line in body.splitlines():
            line = line.strip().rstrip(",")
            item = re.match(r"`?([A-Za-z_][A-Za-z0-9_]*)`?\s+", line)
            if item and item.group(1).upper() not in {"PRIMARY", "UNIQUE", "KEY", "INDEX", "CONSTRAINT", "FOREIGN", "CHECK"}:
                columns.add(item.group(1))
        tables[name] = columns
    return tables


def test_both_supported_full_schema_dumps_have_required_bot_tables_and_columns():
    for dump in DUMPS:
        assert dump.is_file(), dump
        schema = _schema_columns(dump.read_text(encoding="utf-8"))
        for table, expected in REQUIRED_COLUMNS.items():
            assert table in schema, f"{dump.name}: missing table {table}"
            assert expected <= schema[table], f"{dump.name}: {table} missing {expected - schema[table]}"


def test_schema_and_bot_queries_use_ru_en_kz_language_codes():
    for dump in DUMPS:
        sql = dump.read_text(encoding="utf-8")
        assert re.search(r"language\s+ENUM\('ru','en','kz'\)\s+NOT NULL DEFAULT 'ru'", sql, re.I)
    users = (DATABASE / "queries/users.py").read_text(encoding="utf-8")
    assert "('ru','en','kz')" in users
    assert "'kk'" in users  # incoming Telegram language aliases are normalized to kz


def test_foreign_key_columns_match_their_referenced_types():
    schema = _schema_columns_with_types(DUMPS[0].read_text(encoding="utf-8"))
    checked = 0
    for table, (columns, body) in schema.items():
        for line in body.splitlines():
            match = re.search(r"FOREIGN KEY\s*\(\s*`?(\w+)`?\s*\)\s*REFERENCES\s*`?(\w+)`?\s*\(\s*`?(\w+)`?\s*\)", line, re.I)
            if not match:
                continue
            local, referenced_table, referenced_column = match.groups()
            assert local in columns and referenced_table in schema and referenced_column in schema[referenced_table][0]
            assert columns[local] == schema[referenced_table][0][referenced_column], f"{table}.{local} type differs from {referenced_table}.{referenced_column}"
            checked += 1
    assert checked >= 8


def _schema_columns_with_types(sql_text: str):
    tables = {}
    create = re.compile(r"CREATE\s+TABLE\s+`?(\w+)`?\s*\((.*?)\)\s*ENGINE\s*=", re.I | re.S)
    for name, body in create.findall(sql_text):
        columns = {}
        for line in body.splitlines():
            match = re.match(r"\s*`?([A-Za-z_][A-Za-z0-9_]*)`?\s+([A-Za-z]+(?:\(\d+\))?(?:\s+UNSIGNED)?)", line, re.I)
            if match and match.group(1).upper() not in {"PRIMARY", "UNIQUE", "KEY", "INDEX", "CONSTRAINT", "FOREIGN", "CHECK"}:
                columns[match.group(1)] = re.sub(r"\s+", " ", match.group(2).upper())
        tables[name] = (columns, body)
    return tables


def test_bot_startup_checks_schema_instead_of_creating_tables_automatically():
    connection = (ROOT / "bot/database/connection.py").read_text(encoding="utf-8")
    assert "information_schema.COLUMNS" in connection
    assert "не меняет БД автоматически" in connection
    assert "CREATE TABLE" not in connection.upper()


def test_user_notification_and_deletion_queue_migrations_match_full_dumps():
    migrations = {
        "telegram_notification_queue": DATABASE / "migrations/09_telegram_notification_queue.sql",
        "admin_user_deletion_queue": DATABASE / "migrations/12_admin_user_deletion_queue.sql",
    }
    for table, migration in migrations.items():
        assert migration.is_file()
        assert f"CREATE TABLE IF NOT EXISTS {table}" in migration.read_text(encoding="utf-8")
        for dump in DUMPS:
            assert f"CREATE TABLE IF NOT EXISTS {table}" in dump.read_text(encoding="utf-8")


def test_demo_seeds_are_named_and_include_role_activation_keys():
    seeds = DATABASE / "seeds"
    assert (seeds / "01_demo.sql").is_file()
    assert (seeds / "02_full_demo.sql").is_file()
    for seed in (seeds / "01_demo.sql", seeds / "02_full_demo.sql"):
        source = seed.read_text(encoding="utf-8")
        for role in ("buyer", "seller", "admin"):
            assert role in source.lower(), f"{seed.name} is missing role {role}"


def test_full_install_dumps_preserve_the_notification_expiry_and_cleanup_schema():
    schema = (DATABASE / "legacy/01_schema.sql").read_text(encoding="utf-8")
    migration = (DATABASE / "migrations/03_telegram_notification_cleanup.sql").read_text(encoding="utf-8")
    service = (ROOT / "bot/services/notifications/telegram.py").read_text(encoding="utf-8")
    assert "telegram_message_cleanup" in schema
    assert "CREATE TABLE IF NOT EXISTS" in migration
    assert "cleanup_expired_telegram_messages" in service
