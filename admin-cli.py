#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Standalone CLI administration for Basalt Perfume WebApp and MySQL/MariaDB."""

from __future__ import annotations

__version__ = "13.10.32-cli.1"

import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Callable, Any

# AES S-box (FIPS-197)
_SBOX = (
0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16,
)
_RCON = (0x00,0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36,0x6c,0xd8,0xab,0x4d,0x9a)


def _xor_bytes(a: bytes, b: bytes) -> bytes:
    return bytes(x ^ y for x, y in zip(a, b))


def _xtime(v: int) -> int:
    return ((v << 1) ^ 0x11B) & 0xFF if v & 0x80 else (v << 1) & 0xFF


def _expand_aes256_key(key: bytes):
    if len(key) != 32:
        raise ValueError("AES-256 key must be 32 bytes")
    words = [list(key[i:i + 4]) for i in range(0, 32, 4)]
    for i in range(8, 60):
        temp = words[i - 1][:]
        if i % 8 == 0:
            temp = temp[1:] + temp[:1]
            temp = [_SBOX[b] for b in temp]
            temp[0] ^= _RCON[i // 8]
        elif i % 8 == 4:
            temp = [_SBOX[b] for b in temp]
        words.append([words[i - 8][j] ^ temp[j] for j in range(4)])
    return [bytes(sum(words[4 * r:4 * r + 4], [])) for r in range(15)]


def _aes256_encrypt_block(block: bytes, round_keys) -> bytes:
    if len(block) != 16:
        raise ValueError("AES block must be 16 bytes")
    s = list(_xor_bytes(block, round_keys[0]))

    def sub_bytes():
        for i, val in enumerate(s):
            s[i] = _SBOX[val]

    def shift_rows():
        old = s[:]
        for row in range(4):
            for col in range(4):
                s[row + 4 * col] = old[row + 4 * ((col + row) % 4)]

    def mix_columns():
        for col in range(4):
            i = col * 4
            a0, a1, a2, a3 = s[i:i + 4]
            total = a0 ^ a1 ^ a2 ^ a3
            s[i]     = a0 ^ total ^ _xtime(a0 ^ a1)
            s[i + 1] = a1 ^ total ^ _xtime(a1 ^ a2)
            s[i + 2] = a2 ^ total ^ _xtime(a2 ^ a3)
            s[i + 3] = a3 ^ total ^ _xtime(a3 ^ a0)

    for rnd in range(1, 14):
        sub_bytes()
        shift_rows()
        mix_columns()
        s[:] = _xor_bytes(bytes(s), round_keys[rnd])
    sub_bytes()
    shift_rows()
    s[:] = _xor_bytes(bytes(s), round_keys[14])
    return bytes(s)


def _aes256_cbc_encrypt_pkcs7(plaintext: bytes, key: bytes, iv: bytes) -> bytes:
    if len(iv) != 16:
        raise ValueError("IV must be 16 bytes")
    pad_len = 16 - (len(plaintext) % 16)
    data = plaintext + bytes([pad_len]) * pad_len
    round_keys = _expand_aes256_key(key)
    result = bytearray()
    previous = iv
    for start in range(0, len(data), 16):
        block = _xor_bytes(data[start:start + 16], previous)
        encrypted = _aes256_encrypt_block(block, round_keys)
        result.extend(encrypted)
        previous = encrypted
    return bytes(result)


def _derive_keys(secret: str):
    master = hashlib.sha256(secret.encode("utf-8")).digest()
    encryption_key = hmac.new(master, b"encryption", hashlib.sha256).digest()
    authentication_key = hmac.new(master, b"authentication", hashlib.sha256).digest()
    return encryption_key, authentication_key


def _encrypt_key(plain_text: str, secret: str) -> str:
    encryption_key, mac_key = _derive_keys(secret)
    iv = secrets.token_bytes(16)
    cipher = _aes256_cbc_encrypt_pkcs7(plain_text.encode("utf-8"), encryption_key, iv)
    mac = hmac.new(mac_key, iv + cipher, hashlib.sha256).digest()
    return base64.b64encode(iv + mac + cipher).decode("ascii")


def _random_group() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(4))


def _self_test():
    # FIPS-197 AES-256 known-answer test.
    key = bytes.fromhex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
    block = bytes.fromhex("00112233445566778899aabbccddeeff")
    expected = "8ea2b7ca516745bfeafc49904b496089"
    actual = _aes256_encrypt_block(block, _expand_aes256_key(key)).hex()
    if actual != expected:
        raise RuntimeError("Внутренняя проверка AES не прошла. Файлы не создавались.")


def _configured_admin_id_order() -> list[int]:
    """Return configured administrator IDs in their .env order, without duplicates."""
    result: list[int] = []
    seen: set[int] = set()
    for item in os.getenv("ADMIN_IDS", "").split(","):
        item = item.strip()
        if item.isdigit() and int(item) not in seen:
            value = int(item)
            result.append(value)
            seen.add(value)
    return result


def _configured_admin_ids() -> set[int]:
    return set(_configured_admin_id_order())


def _table_exists(conn, table: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM information_schema.TABLES "
            "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s LIMIT 1",
            (table,),
        )
        return cur.fetchone() is not None


def _column_exists(conn, table: str, column: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s AND COLUMN_NAME=%s LIMIT 1",
            (table, column),
        )
        return cur.fetchone() is not None


def _php_config_default_path() -> Path:
    return Path(__file__).resolve().parent / "public_html" / "config" / "database.php"


def _load_cli_db_config(args) -> dict[str, Any]:
    """Resolve the WebApp DB credentials from .env, PHP config and CLI overrides."""
    php_path = getattr(args, "php_config", None)
    php_cfg: dict[str, Any] = {}
    if php_path:
        php_cfg = load_php_db_config(php_path)
    elif _php_config_default_path().is_file():
        php_cfg = load_php_db_config(_php_config_default_path())

    aliases = {
        "host": ("MYSQL_HOST", "DB_HOST"),
        "port": ("MYSQL_PORT", "DB_PORT"),
        "user": ("MYSQL_USER", "DB_USER", "DB_USERNAME"),
        "password": ("MYSQL_PASSWORD", "DB_PASSWORD", "DB_PASS"),
        "database": ("MYSQL_DATABASE", "DB_NAME", "DB_DATABASE"),
    }
    cfg: dict[str, Any] = {}
    for field, names in aliases.items():
        value = None
        for name in names:
            env_value = os.getenv(name)
            if env_value is not None and str(env_value).strip() != "":
                value = str(env_value).strip()
                break
        if value in (None, ""):
            value = php_cfg.get(field)
        if value not in (None, ""):
            cfg[field] = int(value) if field == "port" else value

    for field in ("host", "port", "user", "password", "database"):
        value = getattr(args, "db_" + ("name" if field == "database" else field), None)
        if value is not None and value != "":
            cfg[field] = int(value) if field == "port" else value

    cfg.setdefault("host", "127.0.0.1")
    cfg.setdefault("port", 3306)
    cfg.setdefault("password", "")
    cfg["charset"] = "utf8mb4"
    cfg["connect_timeout"] = 15
    cfg["read_timeout"] = 120
    cfg["write_timeout"] = 120
    cfg["autocommit"] = False
    missing = [key for key in ("host", "user", "database") if cfg.get(key) in (None, "")]
    if missing:
        raise RuntimeError(
            "Не заданы параметры подключения к WebApp БД: " + ", ".join(missing)
            + ". Заполни MYSQL_* в .env, public_html/config/database.php "
              "или передай --db-* аргументы."
        )
    return cfg


def _connect_cli(args):
    try:
        import pymysql
        from pymysql.cursors import DictCursor
    except ImportError as exc:
        raise RuntimeError(
            "Не установлен PyMySQL. Выполни: pip install -r requirements-admin-cli.txt"
        ) from exc
    cfg = _load_cli_db_config(args)
    cfg["cursorclass"] = DictCursor
    return pymysql.connect(**cfg)


def _effective_actor_id(conn, args) -> int | None:
    actor = getattr(args, "actor_id", None)
    candidates = [int(actor)] if actor is not None else _configured_admin_id_order()
    if not candidates or not _table_exists(conn, "users"):
        return None
    with conn.cursor() as cur:
        for candidate in candidates:
            cur.execute("SELECT tg_id FROM users WHERE tg_id=%s LIMIT 1", (candidate,))
            if cur.fetchone():
                return candidate
    return None


def _audit(conn, actor_id: int | None, action: str, details: str = "") -> None:
    if not _table_exists(conn, "admin_logs"):
        return
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO admin_logs(admin_tg_id,action,details) VALUES(%s,%s,%s)",
            (actor_id, action[:64], details[:4000]),
        )


def _get_user(conn, user_id: int) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT u.tg_id,u.username,u.first_name,u.last_name,u.role,u.is_blocked,"
            "u.banned_until,u.ban_reason,u.ban_details,u.price_multiplier,u.created_at,"
            "EXISTS(SELECT 1 FROM admins a WHERE a.tg_id=u.tg_id) AS db_is_admin "
            "FROM users u WHERE u.tg_id=%s LIMIT 1",
            (user_id,),
        )
        return cur.fetchone()


def _is_protected_admin(conn, user: dict[str, Any]) -> bool:
    user_id = int(user["tg_id"])
    return (
        user_id in _configured_admin_ids()
        or bool(user.get("db_is_admin"))
        or str(user.get("role", "")).lower() == "admin"
    )


def _validate_date(value: str, label: str) -> str:
    formats = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M")
    for fmt in formats:
        try:
            dt = datetime.strptime(value, fmt)
            return dt.strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
    raise RuntimeError(f"{label}: ожидается YYYY-MM-DD HH:MM или YYYY-MM-DD HH:MM:SS")


def _ensure_future_database_time(conn, value: str, label: str) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT STR_TO_DATE(%s, '%%Y-%%m-%%d %%H:%%i:%%s') > NOW() AS is_future", (value,))
        row = cur.fetchone()
    if not row or not row["is_future"]:
        raise RuntimeError(f"{label}: дата должна быть в будущем по времени сервера БД.")


def _load_key_encryption_secret(args) -> str:
    secret = os.getenv("KEY_ENCRYPTION_SECRET", "").strip()
    if secret:
        return secret
    php_path = getattr(args, "php_config", None)
    path = Path(php_path).expanduser() if php_path else _php_config_default_path()
    if path.is_file():
        php_text = path.read_text(encoding="utf-8", errors="replace")
        patterns = (
            r"['\"]key_encryption_secret['\"]\s*=>\s*(['\"])(.*?)\1",
            r"define\s*\(\s*['\"]KEY_ENCRYPTION_SECRET['\"]\s*,\s*(['\"])(.*?)\1\s*\)",
        )
        for pattern in patterns:
            match = re.search(pattern, php_text, flags=re.IGNORECASE | re.DOTALL)
            if match and match.group(2).strip():
                return match.group(2).strip()
    return ""


def _decrypt_key(encoded: str, secret: str) -> str | None:
    """Decrypt the WebApp AES-256-CBC/HMAC packet and verify its MAC."""
    if not encoded or not secret:
        return None
    try:
        from cryptography.hazmat.primitives import padding
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    except ImportError as exc:
        raise RuntimeError(
            "Для просмотра полного ключа установи cryptography: "
            "pip install cryptography"
        ) from exc
    try:
        packet = base64.b64decode(encoded, validate=True)
    except Exception:
        return None
    if len(packet) < 64 or (len(packet) - 48) % 16 != 0:
        return None
    iv, mac, ciphertext = packet[:16], packet[16:48], packet[48:]
    encryption_key, authentication_key = _derive_keys(secret)
    expected = hmac.new(authentication_key, iv + ciphertext, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, mac):
        return None
    decryptor = Cipher(algorithms.AES(encryption_key), modes.CBC(iv)).decryptor()
    padded = decryptor.update(ciphertext) + decryptor.finalize()
    unpadder = padding.PKCS7(algorithms.AES.block_size).unpadder()
    try:
        raw = unpadder.update(padded) + unpadder.finalize()
        return raw.decode("utf-8")
    except Exception:
        return None


def _format_table(headers: list[str], rows: list[list[Any]]) -> None:
    if not rows:
        print("(нет данных)")
        return
    values = [[str(value if value is not None else "-") for value in row] for row in rows]
    widths = [len(str(h)) for h in headers]
    for row in values:
        for idx, value in enumerate(row):
            widths[idx] = max(widths[idx], len(value))
    fmt = " | ".join("{:<" + str(width) + "}" for width in widths)
    print(fmt.format(*headers))
    print("-+-".join("-" * width for width in widths))
    for row in values:
        print(fmt.format(*row))


def _store_setting(conn, key: str, value: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO app_settings(setting_key,setting_value) VALUES(%s,%s) "
            "ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)",
            (key, value),
        )


def _db_command(args) -> int:
    conn = _connect_cli(args)
    try:
        actor_id = _effective_actor_id(conn, args)
        with conn.cursor() as cur:
            command = args.command

            if command == "db-info":
                cur.execute("SELECT VERSION() AS version, DATABASE() AS database_name, CURRENT_USER() AS db_user, NOW() AS server_time")
                row = cur.fetchone()
                print(f"MySQL/MariaDB: {row['version']}")
                print(f"База данных: {row['database_name']}")
                print(f"Пользователь подключения: {row['db_user']}")
                print(f"Время сервера БД: {row['server_time']}")

            elif command == "stats":
                checks = [
                    ("users", "SELECT COUNT(*) AS n FROM users"),
                    ("keys", "SELECT COUNT(*) AS n FROM subscription_keys"),
                    ("active_subscriptions", "SELECT COUNT(DISTINCT used_by_tg_id) AS n FROM subscription_keys WHERE used_by_tg_id IS NOT NULL AND COALESCE(starts_at,activated_at)<=NOW() AND available_until>NOW() AND is_frozen=0"),
                    ("queued_subscriptions", "SELECT COUNT(*) AS n FROM subscription_keys WHERE used_by_tg_id IS NOT NULL AND starts_at>NOW() AND available_until>NOW() AND is_frozen=0"),
                    ("price_lists", "SELECT COUNT(*) AS n FROM price_lists"),
                    ("products", "SELECT COUNT(*) AS n FROM products"),
                    ("review_rows", "SELECT COUNT(*) AS n FROM products WHERE needs_review=1"),
                    ("web_upload_site_jobs", "SELECT COUNT(*) AS n FROM web_upload_site_jobs"),
                ]
                for label, sql in checks:
                    try:
                        cur.execute(sql)
                        print(f"{label}: {cur.fetchone()['n']}")
                    except Exception:
                        conn.rollback()
                        print(f"{label}: таблица/поле отсутствует")
                cur.execute("SELECT setting_key,setting_value FROM app_settings WHERE setting_key IN ('maintenance_mode','maintenance_title','maintenance_until','browser_access_enabled','session_sync_enabled','web_price_upload_enabled') ORDER BY setting_key")
                print("\nНастройки:")
                for item in cur.fetchall():
                    print(f"  {item['setting_key']}: {item['setting_value']}")

            elif command == "tables":
                cur.execute(
                    "SELECT TABLE_NAME,ENGINE,TABLE_ROWS,ROUND((DATA_LENGTH+INDEX_LENGTH)/1024/1024,2) AS size_mb "
                    "FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME"
                )
                rows = cur.fetchall()
                _format_table(["TABLE", "ENGINE", "APPROX_ROWS", "SIZE_MB"], [[r["TABLE_NAME"], r["ENGINE"], r["TABLE_ROWS"], r["size_mb"]] for r in rows])

            elif command == "users":
                sql = (
                    "SELECT u.tg_id,u.username,u.first_name,u.last_name,u.role,u.is_blocked,u.banned_until,"
                    "EXISTS(SELECT 1 FROM admins a WHERE a.tg_id=u.tg_id) AS db_is_admin,"
                    "(SELECT MAX(k.available_until) FROM subscription_keys k WHERE k.used_by_tg_id=u.tg_id AND k.is_frozen=0) AS subscription_until "
                    "FROM users u WHERE 1=1"
                )
                params: list[Any] = []
                protected_admin_sql = "(u.role='admin' OR EXISTS(SELECT 1 FROM admins ax WHERE ax.tg_id=u.tg_id))"
                configured_ids = sorted(_configured_admin_ids())
                if configured_ids:
                    protected_admin_sql += " OR u.tg_id IN (" + ",".join(["%s"] * len(configured_ids)) + ")"
                protected_admin_sql = "(" + protected_admin_sql + ")"
                if args.role == "admin":
                    sql += " AND " + protected_admin_sql
                    params.extend(configured_ids)
                elif args.role:
                    sql += " AND u.role=%s AND NOT " + protected_admin_sql
                    params.append(args.role)
                    params.extend(configured_ids)
                if args.status == "blocked":
                    sql += " AND u.is_blocked=1 AND (u.banned_until IS NULL OR u.banned_until>NOW())"
                elif args.status == "active":
                    sql += " AND (u.is_blocked=0 OR (u.banned_until IS NOT NULL AND u.banned_until<=NOW()))"
                if args.search:
                    needle = "%" + args.search.strip() + "%"
                    sql += " AND (CAST(u.tg_id AS CHAR) LIKE %s OR u.username LIKE %s OR u.first_name LIKE %s OR u.last_name LIKE %s)"
                    params.extend([needle] * 4)
                sql += " ORDER BY u.created_at DESC LIMIT %s"; params.append(max(1, min(args.limit, 1000)))
                cur.execute(sql, params)
                rows = cur.fetchall()
                _format_table(
                    ["TG_ID", "USERNAME", "NAME", "ROLE", "BLOCKED", "BANNED_UNTIL", "SUBSCRIPTION_UNTIL"],
                    [[r["tg_id"], "@" + r["username"] if r["username"] else "-", " ".join(x for x in (r["first_name"], r["last_name"]) if x), "admin" if r["db_is_admin"] or int(r["tg_id"]) in _configured_admin_ids() or r["role"] == "admin" else r["role"], r["is_blocked"], r["banned_until"], r["subscription_until"]] for r in rows],
                )

            elif command == "user":
                user = _get_user(conn, args.user_id)
                if not user:
                    raise RuntimeError("Пользователь не найден.")
                print(f"Telegram ID: {user['tg_id']}")
                print(f"Username: @{user['username']}" if user["username"] else "Username: -")
                print(f"Имя: {' '.join(x for x in (user['first_name'], user['last_name']) if x) or '-'}")
                print(f"Роль: {'admin' if _is_protected_admin(conn, user) else user['role']}")
                print(f"Множитель цены: {user['price_multiplier']}")
                print(f"Блокировка: {user['is_blocked']} / {user['banned_until'] or 'permanent/none'}")
                print(f"Причина: {user['ban_reason'] or '-'}")
                print(f"Создан: {user['created_at']}")
                cur.execute("SELECT id,filename,status,size_bytes,imported_at FROM price_lists WHERE owner_tg_id=%s ORDER BY imported_at DESC,id DESC", (args.user_id,))
                print("\nПрайс-листы:")
                _format_table(["ID", "FILE", "STATUS", "BYTES", "IMPORTED"], [[r["id"], r["filename"], r["status"], r["size_bytes"], r["imported_at"]] for r in cur.fetchall()])
                cur.execute("SELECT id,key_prefix,role_on_activate,starts_at,available_until,is_frozen FROM subscription_keys WHERE used_by_tg_id=%s ORDER BY starts_at,id", (args.user_id,))
                print("\nКлючи пользователя:")
                _format_table(["ID", "PREFIX", "ROLE", "STARTS_AT", "UNTIL", "FROZEN"], [[r["id"], r["key_prefix"], r["role_on_activate"], r["starts_at"], r["available_until"], r["is_frozen"]] for r in cur.fetchall()])
                if _table_exists(conn, "user_favorites"):
                    cur.execute(
                        "SELECT COUNT(*) AS n FROM user_favorites f "
                        "JOIN products p ON p.id=f.product_id "
                        "JOIN source_rows sr ON sr.id=p.source_row_id "
                        "JOIN price_lists pl ON pl.id=sr.price_list_id WHERE f.user_tg_id=%s",
                        (args.user_id,),
                    )
                    print(f"Избранное (актуальные товары): {cur.fetchone()['n']}")

            elif command == "favorites":
                if not _table_exists(conn, "user_favorites"):
                    raise RuntimeError("Таблица user_favorites отсутствует.")
                cur.execute(
                    "SELECT p.id,p.brand,p.name,p.type,p.category,p.volume_text,p.volume_ml,"
                    "ROUND(p.price_usd*p.price_multiplier,2) AS effective_price,p.currency,"
                    "pl.id AS price_list_id,pl.filename,pl.owner_tg_id AS seller_tg_id "
                    "FROM user_favorites f JOIN products p ON p.id=f.product_id "
                    "JOIN source_rows sr ON sr.id=p.source_row_id "
                    "JOIN price_lists pl ON pl.id=sr.price_list_id "
                    "WHERE f.user_tg_id=%s ORDER BY pl.owner_tg_id,p.name ASC LIMIT %s",
                    (args.user_id, max(1, min(args.limit, 1000))),
                )
                rows = cur.fetchall()
                _format_table(
                    ["PRODUCT_ID", "BRAND", "NAME", "TYPE", "CATEGORY", "VOLUME", "PRICE", "CURRENCY", "PRICE_LIST", "FILE", "SELLER_ID"],
                    [[r["id"],r["brand"],r["name"],r["type"],r["category"],r["volume_text"] or r["volume_ml"],r["effective_price"],r["currency"],r["price_list_id"],r["filename"],r["seller_tg_id"]] for r in rows],
                )

            elif command == "set-role":
                user = _get_user(conn, args.user_id)
                if not user:
                    raise RuntimeError("Пользователь не найден.")
                protected = _is_protected_admin(conn, user)
                if protected and args.role != "admin":
                    raise RuntimeError("Нельзя изменить роль защищённого профиля администратора.")
                conn.begin()
                cur.execute("UPDATE users SET role=%s WHERE tg_id=%s", (args.role, args.user_id))
                if args.role == "admin":
                    cur.execute("INSERT IGNORE INTO admins(tg_id) VALUES(%s)", (args.user_id,))
                elif args.user_id not in _configured_admin_ids():
                    cur.execute("DELETE FROM admins WHERE tg_id=%s", (args.user_id,))
                _audit(conn, actor_id, "admin_cli_set_role", f"target={args.user_id} role={args.role}")
                conn.commit()
                print("Роль обновлена.")

            elif command == "block":
                user = _get_user(conn, args.user_id)
                if not user:
                    raise RuntimeError("Пользователь не найден.")
                if _is_protected_admin(conn, user):
                    raise RuntimeError("Нельзя блокировать защищённый профиль администратора.")
                if args.permanent:
                    conn.begin()
                    cur.execute(
                        "UPDATE users SET is_blocked=1,banned_until=NULL,ban_reason=%s,ban_details=%s WHERE tg_id=%s",
                        (args.reason[:500], (args.details or args.reason)[:4000], args.user_id),
                    )
                    until_label = "permanent"
                elif args.until:
                    until = _validate_date(args.until, "--until")
                    _ensure_future_database_time(conn, until, "--until")
                    conn.begin()
                    cur.execute(
                        "UPDATE users SET is_blocked=1,banned_until=%s,ban_reason=%s,ban_details=%s WHERE tg_id=%s",
                        (until, args.reason[:500], (args.details or args.reason)[:4000], args.user_id),
                    )
                    until_label = until
                else:
                    unit_options = (("minutes", args.minutes, "MINUTE"), ("hours", args.hours, "HOUR"), ("days", args.days, "DAY"))
                    _, amount, unit_sql = next((item for item in unit_options if item[1] != 0), ("", 0, ""))
                    if amount < 1 or amount > 36500:
                        raise RuntimeError("Срок блокировки должен быть от 1 до 36500 единиц.")
                    conn.begin()
                    cur.execute(
                        f"UPDATE users SET is_blocked=1,banned_until=DATE_ADD(NOW(), INTERVAL {int(amount)} {unit_sql}),ban_reason=%s,ban_details=%s WHERE tg_id=%s",
                        (args.reason[:500], (args.details or args.reason)[:4000], args.user_id),
                    )
                    until_label = f"+{amount} {unit_sql.lower()}"
                _audit(conn, actor_id, "admin_cli_block", f"target={args.user_id} until={until_label} reason={args.reason[:200]}")
                conn.commit()
                print("Пользователь заблокирован.")

            elif command == "unblock":
                user = _get_user(conn, args.user_id)
                if not user:
                    raise RuntimeError("Пользователь не найден.")
                if _is_protected_admin(conn, user):
                    raise RuntimeError("Нельзя изменять блокировку защищённого профиля администратора.")
                conn.begin()
                cur.execute("UPDATE users SET is_blocked=0,banned_until=NULL,ban_reason=NULL,ban_details=NULL WHERE tg_id=%s", (args.user_id,))
                _audit(conn, actor_id, "admin_cli_unblock", f"target={args.user_id}")
                conn.commit()
                print("Блокировка снята.")

            elif command == "delete-user":
                if args.confirm != str(args.user_id):
                    raise RuntimeError("Удаление не подтверждено. --confirm должен в точности совпадать с Telegram ID.")
                user = _get_user(conn, args.user_id)
                if not user:
                    raise RuntimeError("Пользователь не найден.")
                if args.user_id == actor_id:
                    raise RuntimeError("Нельзя удалить текущий профиль администратора.")
                if _is_protected_admin(conn, user):
                    raise RuntimeError("Удаление администраторов запрещено.")
                conn.begin()
                if _table_exists(conn, "user_favorites"):
                    cur.execute(
                        "DELETE f FROM user_favorites f LEFT JOIN products p ON p.id=f.product_id "
                        "LEFT JOIN source_rows sr ON sr.id=p.source_row_id "
                        "LEFT JOIN price_lists pl ON pl.id=sr.price_list_id "
                        "WHERE f.user_tg_id=%s OR pl.owner_tg_id=%s",
                        (args.user_id, args.user_id),
                    )
                # Remove WebApp-owned database records only; uploaded files remain on disk.
                cur.execute("UPDATE subscription_keys SET owner_tg_id=NULL WHERE owner_tg_id=%s AND used_by_tg_id IS NOT NULL AND used_by_tg_id<>%s", (args.user_id, args.user_id))
                cur.execute("DELETE FROM subscription_keys WHERE used_by_tg_id=%s OR owner_tg_id=%s", (args.user_id, args.user_id))
                cur.execute("DELETE FROM price_lists WHERE owner_tg_id=%s", (args.user_id,))
                cur.execute("DELETE FROM users WHERE tg_id=%s", (args.user_id,))
                if cur.rowcount != 1:
                    raise RuntimeError("Пользователь не был удалён.")
                _audit(conn, actor_id, "admin_cli_delete_user", f"target={args.user_id}")
                conn.commit()
                print(f"Пользователь {args.user_id} удалён из WebApp БД. Файлы в файловом хранилище не затрагивались.")

            elif command == "extend-subscription":
                units = {"hours": ("HOUR", 8760), "days": ("DAY", 3650), "months": ("MONTH", 120)}
                if args.unit not in units or not 1 <= args.amount <= units[args.unit][1]:
                    raise RuntimeError("Проверь количество или единицу продления.")
                user = _get_user(conn, args.user_id)
                if not user:
                    raise RuntimeError("Пользователь не найден.")
                if _is_protected_admin(conn, user):
                    raise RuntimeError("Нельзя продлевать подписку профиля администратора.")
                if not _column_exists(conn, "subscription_keys", "starts_at"):
                    raise RuntimeError("В БД отсутствует subscription_keys.starts_at. Сначала примени миграцию 014_subscription_key_queue.sql.")
                unit_sql = units[args.unit][0]
                conn.begin()
                cur.execute("SELECT tg_id FROM users WHERE tg_id=%s FOR UPDATE", (args.user_id,))
                if not cur.fetchone():
                    raise RuntimeError("Пользователь не найден.")
                cur.execute(
                    "SELECT id,available_until,is_frozen FROM subscription_keys "
                    "WHERE used_by_tg_id=%s AND starts_at<=NOW() AND available_until>NOW() "
                    "ORDER BY starts_at DESC,id DESC LIMIT 1 FOR UPDATE",
                    (args.user_id,),
                )
                key = cur.fetchone()
                if not key or key["is_frozen"] or not key["available_until"]:
                    raise RuntimeError("У пользователя нет активной незамороженной подписки.")
                cur.execute(
                    f"UPDATE subscription_keys SET available_until=DATE_ADD(GREATEST(available_until,NOW()), INTERVAL {int(args.amount)} {unit_sql}) "
                    "WHERE id=%s AND used_by_tg_id=%s AND is_frozen=0 AND available_until>NOW()",
                    (int(key["id"]), args.user_id),
                )
                if cur.rowcount != 1:
                    raise RuntimeError("Срок подписки не изменился.")
                cur.execute(
                    f"UPDATE subscription_keys SET starts_at=DATE_ADD(starts_at, INTERVAL {int(args.amount)} {unit_sql}), "
                    f"available_until=DATE_ADD(available_until, INTERVAL {int(args.amount)} {unit_sql}) "
                    "WHERE used_by_tg_id=%s AND starts_at>=%s AND available_until>starts_at AND is_frozen=0",
                    (args.user_id, key["available_until"]),
                )
                _audit(conn, actor_id, "admin_cli_extend_subscription", f"target={args.user_id} key={key['id']} amount={args.amount} unit={args.unit}")
                conn.commit()
                print(f"Подписка пользователя {args.user_id} продлена на {args.amount} {args.unit}; очередь продлений сдвинута.")

            elif command == "keys":
                filters = {
                    "free": "usable=1 AND used_by_tg_id IS NULL",
                    "used": "used_by_tg_id IS NOT NULL",
                    "active": "used_by_tg_id IS NOT NULL AND starts_at<=NOW() AND available_until>NOW() AND is_frozen=0",
                    "queued": "used_by_tg_id IS NOT NULL AND starts_at>NOW() AND available_until>NOW() AND is_frozen=0",
                    "expired": "used_by_tg_id IS NOT NULL AND available_until<=NOW() AND is_frozen=0",
                    "frozen": "is_frozen=1",
                }
                sql = "SELECT id,key_prefix,role_on_activate,duration_days,usable,used_by_tg_id,starts_at,available_until,is_frozen,created_at FROM subscription_keys WHERE 1=1"
                if args.status != "all":
                    sql += " AND " + filters[args.status]
                params: list[Any] = []
                if args.role:
                    sql += " AND role_on_activate=%s"; params.append(args.role)
                sql += " ORDER BY id DESC LIMIT %s"; params.append(max(1, min(args.limit, 1000)))
                cur.execute(sql, params)
                rows = cur.fetchall()
                _format_table(["ID", "PREFIX", "ROLE", "DAYS", "USABLE", "USED_BY", "STARTS", "UNTIL", "FROZEN", "CREATED"], [[r["id"],r["key_prefix"],r["role_on_activate"],r["duration_days"],r["usable"],r["used_by_tg_id"],r["starts_at"],r["available_until"],r["is_frozen"],r["created_at"]] for r in rows])

            elif command == "key":
                cur.execute("SELECT id,key_prefix,key_hash,key_ciphertext,duration_days,role_on_activate,usable,used_by_tg_id,starts_at,available_until,is_frozen,created_at FROM subscription_keys WHERE id=%s LIMIT 1", (args.key_id,))
                key = cur.fetchone()
                if not key:
                    raise RuntimeError("Ключ не найден.")
                for field in ("id","key_prefix","duration_days","role_on_activate","usable","used_by_tg_id","starts_at","available_until","is_frozen","created_at"):
                    print(f"{field}: {key[field]}")
                if args.reveal:
                    demo_keys = {"DEMO-30-DAYS": "DEMO-30-DAYS-A1B2", "DEMO-7-DAYS": "DEMO-7-DAYS-C3D4"}
                    if key["key_prefix"] in demo_keys:
                        print(f"FULL_KEY: {demo_keys[key['key_prefix']]}")
                    else:
                        secret = _load_key_encryption_secret(args)
                        if not secret:
                            raise RuntimeError("Для расшифровки задай KEY_ENCRYPTION_SECRET в .env. Полный ключ недоступен без выделенного секрета шифрования.")
                        full_key = _decrypt_key(str(key["key_ciphertext"] or ""), secret)
                        if full_key is None or not hmac.compare_digest(hashlib.sha256(full_key.encode("utf-8")).hexdigest(), str(key["key_hash"])):
                            raise RuntimeError("Ключ не удалось расшифровать и проверить по key_hash. Проверь KEY_ENCRYPTION_SECRET.")
                        print(f"FULL_KEY: {full_key}")

            elif command == "generate-keys":
                if not 1 <= args.count <= 100 or not 1 <= args.days <= 3650:
                    raise RuntimeError("--count: 1..100; --days: 1..3650.")
                secret = _load_key_encryption_secret(args)
                if not secret:
                    raise RuntimeError("Для генерации ключей задай KEY_ENCRYPTION_SECRET в .env.")
                _self_test()
                conn.begin()
                generated: list[str] = []
                for _ in range(args.count):
                    plain = "BP-" + "-".join(_random_group() for _ in range(4))
                    cipher = _encrypt_key(plain, secret)
                    cur.execute(
                        "INSERT INTO subscription_keys(key_hash,key_prefix,key_ciphertext,usable,duration_days,role_on_activate) "
                        "VALUES(%s,%s,%s,1,%s,%s)",
                        (hashlib.sha256(plain.encode("utf-8")).hexdigest(), plain[:7], cipher, args.days, args.role),
                    )
                    generated.append(plain)
                _audit(conn, actor_id, "admin_cli_generate_keys", f"count={args.count} days={args.days} role={args.role}")
                conn.commit()
                if args.out_file:
                    out = Path(args.out_file).expanduser().resolve()
                    try:
                        out.parent.mkdir(parents=True, exist_ok=True)
                        descriptor = os.open(str(out), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as key_file:
                            key_file.write("\n".join(generated) + "\n")
                        print(f"Ключи сохранены в новый файл: {out}")
                    except FileExistsError:
                        print(f"Файл уже существует, не перезаписываю: {out}", file=sys.stderr)
                    except OSError as exc:
                        print(f"Не удалось сохранить файл ключей ({exc}); открытые ключи будут выведены в терминал.", file=sys.stderr)
                print(f"Создано ключей: {len(generated)}; срок: {args.days} дн.; роль: {args.role}")
                print("СОХРАНИ ЭТИ КЛЮЧИ СЕЙЧАС — повторно получить открытый текст нельзя:")
                for plain in generated:
                    print(plain)

            elif command == "disable-key":
                conn.begin()
                cur.execute("UPDATE subscription_keys SET usable=0 WHERE id=%s AND used_by_tg_id IS NULL AND usable=1", (args.key_id,))
                if cur.rowcount != 1:
                    raise RuntimeError("Свободный активный ключ не найден или уже отключён.")
                _audit(conn, actor_id, "admin_cli_disable_key", f"key={args.key_id}")
                conn.commit()
                print(f"Ключ #{args.key_id} отключён.")

            elif command == "assign-key":
                user = _get_user(conn, args.user_id)
                if not user:
                    raise RuntimeError("Пользователь не найден.")
                if _is_protected_admin(conn, user):
                    raise RuntimeError("Нельзя менять ключ защищённого профиля администратора.")
                if not _column_exists(conn, "subscription_keys", "starts_at"):
                    raise RuntimeError("В БД отсутствует subscription_keys.starts_at. Сначала примени миграцию 014_subscription_key_queue.sql.")
                conn.begin()
                cur.execute("SELECT tg_id FROM users WHERE tg_id=%s FOR UPDATE", (args.user_id,))
                if not cur.fetchone():
                    raise RuntimeError("Пользователь не найден.")
                cur.execute("SELECT id,duration_days,usable,used_by_tg_id,role_on_activate,key_prefix FROM subscription_keys WHERE id=%s FOR UPDATE", (args.key_id,))
                key = cur.fetchone()
                if not key or not key["usable"] or key["used_by_tg_id"] is not None:
                    raise RuntimeError("Ключ недоступен, уже использован или не найден.")
                # This mirrors the current WebApp action: close all still-open segments,
                # then start the selected key immediately.
                cur.execute("UPDATE subscription_keys SET available_until=NOW(),is_frozen=0,frozen_at=NULL,frozen_remaining_sec=NULL WHERE used_by_tg_id=%s AND available_until>NOW() AND is_frozen=0", (args.user_id,))
                cur.execute("UPDATE subscription_keys SET usable=0,used_by_tg_id=%s,activated_at=NOW(),starts_at=NOW(),available_until=DATE_ADD(NOW(),INTERVAL duration_days DAY),is_frozen=0,frozen_at=NULL,frozen_remaining_sec=NULL WHERE id=%s AND usable=1 AND used_by_tg_id IS NULL", (args.user_id, args.key_id))
                if cur.rowcount != 1:
                    raise RuntimeError("Не удалось назначить ключ.")
                prefix_tokens = {token for token in str(key["key_prefix"] or "").upper().replace("_", "-").split("-") if token}
                if "SELLER" in prefix_tokens:
                    role_value = "seller"
                elif "BUYER" in prefix_tokens:
                    role_value = "buyer"
                elif "ADMIN" in prefix_tokens:
                    role_value = "admin"
                else:
                    role_value = str(key["role_on_activate"] or "").lower()
                    if role_value not in ("buyer", "seller", "admin"):
                        role_value = "buyer"
                cur.execute("UPDATE users SET role=%s WHERE tg_id=%s", (role_value, args.user_id))
                if role_value == "admin":
                    cur.execute("INSERT IGNORE INTO admins(tg_id) VALUES(%s)", (args.user_id,))
                elif args.user_id not in _configured_admin_ids():
                    cur.execute("DELETE FROM admins WHERE tg_id=%s", (args.user_id,))
                _audit(conn, actor_id, "admin_cli_assign_key", f"target={args.user_id} key={args.key_id} role={role_value}")
                conn.commit()
                print(f"Ключ #{args.key_id} назначен пользователю {args.user_id}; роль обновлена: {role_value}.")

            elif command == "price-lists":
                sql = (
                    "SELECT pl.id,pl.filename,pl.owner_tg_id,u.username,pl.status,pl.size_bytes,pl.imported_at,"
                    "COUNT(DISTINCT sr.id) AS source_rows,COUNT(DISTINCT p.id) AS products "
                    "FROM price_lists pl LEFT JOIN users u ON u.tg_id=pl.owner_tg_id "
                    "LEFT JOIN source_rows sr ON sr.price_list_id=pl.id "
                    "LEFT JOIN products p ON p.source_row_id=sr.id WHERE 1=1"
                )
                params: list[Any] = []
                if args.user_id is not None:
                    sql += " AND pl.owner_tg_id=%s"; params.append(args.user_id)
                if args.status:
                    sql += " AND pl.status=%s"; params.append(args.status)
                sql += " GROUP BY pl.id ORDER BY pl.imported_at DESC,pl.id DESC LIMIT %s"; params.append(max(1, min(args.limit, 1000)))
                cur.execute(sql, params)
                rows = cur.fetchall()
                _format_table(["ID","FILE","OWNER_TG_ID","USERNAME","STATUS","BYTES","SOURCE_ROWS","PRODUCTS","IMPORTED"], [[r["id"],r["filename"],r["owner_tg_id"],("@"+r["username"]) if r["username"] else "-",r["status"],r["size_bytes"],r["source_rows"],r["products"],r["imported_at"]] for r in rows])

            elif command == "delete-price-list":
                if args.confirm != str(args.price_list_id):
                    raise RuntimeError("Удаление не подтверждено. --confirm должен совпадать с ID прайс-листа.")
                conn.begin()
                if _table_exists(conn, "user_favorites"):
                    cur.execute(
                        "DELETE f FROM user_favorites f JOIN products p ON p.id=f.product_id "
                        "JOIN source_rows sr ON sr.id=p.source_row_id WHERE sr.price_list_id=%s",
                        (args.price_list_id,),
                    )
                cur.execute("DELETE FROM price_lists WHERE id=%s", (args.price_list_id,))
                if cur.rowcount != 1:
                    raise RuntimeError("Прайс-лист не найден.")
                _audit(conn, actor_id, "admin_cli_delete_price_list", f"price_list={args.price_list_id}")
                conn.commit()
                print(f"Прайс-лист #{args.price_list_id} удалён из БД; физический файл не затронут.")

            elif command == "uploads":
                table = "web_upload_site_jobs"
                if not _table_exists(conn, table):
                    raise RuntimeError("Таблица web_upload_site_jobs отсутствует. Проверь миграцию 013_website_upload_queue.sql.")
                sql = "SELECT id,price_list_id,owner_tg_id,filename,size_bytes,status,attempts,locked_at,last_error,created_at,updated_at FROM web_upload_site_jobs WHERE 1=1"
                params: list[Any] = []
                if args.status:
                    sql += " AND status=%s"; params.append(args.status)
                sql += " ORDER BY created_at DESC,id DESC LIMIT %s"; params.append(max(1, min(args.limit, 1000)))
                cur.execute(sql, params)
                rows = cur.fetchall()
                _format_table(["ID","PRICE_LIST","OWNER","FILE","BYTES","STATUS","TRIES","LOCKED","LAST_ERROR","CREATED","UPDATED"], [[row["id"],row["price_list_id"],row["owner_tg_id"],row["filename"],row["size_bytes"],row["status"],row["attempts"],row["locked_at"],row["last_error"],row["created_at"],row["updated_at"]] for row in rows])

            elif command == "retry-upload":
                table = "web_upload_site_jobs"
                if not _table_exists(conn, table):
                    raise RuntimeError(f"Таблица {table} отсутствует.")
                conn.begin()
                cur.execute(
                    f"UPDATE `{table}` SET status='pending',attempts=0,locked_at=NULL,last_error=NULL,updated_at=NOW() "
                    "WHERE id=%s AND status IN ('error','failed')",
                    (args.job_id,),
                )
                if cur.rowcount != 1:
                    raise RuntimeError("Задача не найдена или её статус не error/failed.")
                _audit(conn, actor_id, "admin_cli_retry_upload", f"queue=site job={args.job_id}")
                conn.commit()
                print(f"Веб-загрузка #{args.job_id} возвращена в очередь Worker.")

            elif command == "errors":
                if not _table_exists(conn, "parse_errors"):
                    raise RuntimeError("Таблица parse_errors отсутствует.")
                sql = "SELECT id,tg_id,file_id,row_index,error_code,raw_title,details,created_at FROM parse_errors WHERE 1=1"
                params: list[Any] = []
                if args.user_id is not None:
                    sql += " AND tg_id=%s"; params.append(args.user_id)
                sql += " ORDER BY created_at DESC,id DESC LIMIT %s"; params.append(max(1, min(args.limit, 1000)))
                cur.execute(sql, params)
                rows = cur.fetchall()
                _format_table(["ID","TG_ID","FILE_ID","ROW","ERROR","RAW_TITLE","DETAILS","CREATED"], [[r["id"],r["tg_id"],r["file_id"],r["row_index"],r["error_code"],r["raw_title"],r["details"],r["created_at"]] for r in rows])

            elif command == "logs":
                sql = "SELECT l.id,l.admin_tg_id,u.username,l.action,l.details,l.created_at FROM admin_logs l LEFT JOIN users u ON u.tg_id=l.admin_tg_id WHERE 1=1"
                params: list[Any] = []
                if args.actor is not None:
                    sql += " AND l.admin_tg_id=%s"; params.append(args.actor)
                if args.action:
                    sql += " AND l.action LIKE %s"; params.append("%" + args.action + "%")
                sql += " ORDER BY l.id DESC LIMIT %s"; params.append(max(1, min(args.limit, 1000)))
                cur.execute(sql, params)
                rows = cur.fetchall()
                _format_table(["ID","ACTOR","USERNAME","ACTION","DETAILS","CREATED"], [[r["id"],r["admin_tg_id"],("@"+r["username"]) if r["username"] else "-",r["action"],r["details"],r["created_at"]] for r in rows])

            elif command == "settings":
                cur.execute("SELECT setting_key,setting_value,updated_at FROM app_settings ORDER BY setting_key")
                rows = cur.fetchall()
                _format_table(["KEY","VALUE","UPDATED"], [[r["setting_key"],r["setting_value"],r["updated_at"]] for r in rows])

            elif command == "set-setting":
                if not args.key or len(args.key) > 64:
                    raise RuntimeError("Ключ настройки должен содержать 1..64 символа.")
                conn.begin()
                _store_setting(conn, args.key, args.value)
                _audit(conn, actor_id, "admin_cli_set_setting", f"key={args.key} value_length={len(args.value)}")
                conn.commit()
                print(f"Настройка {args.key} обновлена.")

            elif command == "browser-access":
                if args.enable == args.disable:
                    raise RuntimeError("Укажи ровно один флаг: --enable или --disable.")
                browser_enabled = "1" if args.enable else "0"
                conn.begin()
                _store_setting(conn, "browser_access_enabled", browser_enabled)
                if args.session_sync != "keep":
                    _store_setting(conn, "session_sync_enabled", "1" if args.session_sync == "enable" else "0")
                _audit(conn, actor_id, "admin_cli_browser_access", f"browser_access={browser_enabled} session_sync={args.session_sync}")
                conn.commit()
                print(f"Доступ из браузера: {'включён' if args.enable else 'выключен'}.")
                if args.session_sync != "keep":
                    print(f"Синхронизация сессий: {'включена' if args.session_sync == 'enable' else 'выключена'}.")

            elif command == "maintenance":
                if args.enable == args.disable:
                    raise RuntimeError("Укажи ровно один флаг: --enable или --disable.")
                if args.enable and (not args.title.strip() or not args.message.strip()):
                    raise RuntimeError("Для включения техработ обязательны --title и --message.")
                if args.enable and not args.until:
                    raise RuntimeError("Для включения техработ укажи --until с будущей датой окончания.")
                until = _validate_date(args.until, "--until") if args.enable else ""
                if args.enable:
                    _ensure_future_database_time(conn, until, "--until")
                values = {
                    "maintenance_mode": "1" if args.enable else "0",
                    "maintenance_title": args.title[:190] or "Технические работы",
                    "maintenance_message": args.message[:4000] or "Сервис временно недоступен. Попробуйте позже.",
                    "maintenance_until": until,
                }
                conn.begin()
                for key, value in values.items():
                    _store_setting(conn, key, value)
                _audit(conn, actor_id, "admin_cli_maintenance", f"enabled={int(args.enable)} until={until or 'none'} title={values['maintenance_title']}")
                conn.commit()
                print("Технические работы включены." if args.enable else "Технические работы завершены.")

            elif command == "announce":
                title = args.title.strip()[:190]
                message = args.message.strip()[:4000]
                if not title or not message:
                    raise RuntimeError("Заголовок и текст уведомления обязательны.")
                conn.begin()
                cur.execute(
                    "INSERT INTO app_notifications(tg_id,kind,title,body) "
                    "SELECT u.tg_id,'update',%s,%s FROM users u "
                    "LEFT JOIN user_settings s ON s.tg_id=u.tg_id "
                    "WHERE COALESCE(s.notify_updates,1)=1",
                    (title, message),
                )
                recipients = int(cur.rowcount)
                _audit(conn, actor_id, "admin_cli_announce", f"recipients={recipients} title={title}")
                conn.commit()
                print(f"Создано уведомлений в WebApp: {recipients}.")

            else:
                raise RuntimeError(f"Неизвестная команда: {command}")

        # All write operations commit explicitly in their command branch.
        return 0
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        conn.close()

def _clean_cache_directories(root: Path) -> int:
    """Remove generated Python/app cache folders beneath a selected project root."""
    root = root.resolve()
    cache_names = {"__pycache__", "__cache__"}
    candidates = []
    for path in root.rglob("*"):
        try:
            if path.name in cache_names and path.is_dir() and not path.is_symlink():
                candidates.append(path)
        except OSError:
            continue
    removed = 0
    # Deepest paths first so nested cache folders are counted/removed deterministically.
    for path in sorted(candidates, key=lambda item: len(item.parts), reverse=True):
        try:
            if path.exists() and path.is_dir() and not path.is_symlink():
                shutil.rmtree(path)
                removed += 1
        except OSError as exc:
            print(f"Не удалось удалить кэш {path}: {exc}", file=sys.stderr)
    return removed



# --- Integrated database migration helpers (formerly migrate_database.py) ---
def _first_env(prefixes: tuple[str, ...], field: str, default: str = "") -> str:
    for prefix in prefixes:
        value = os.getenv(prefix + field, "")
        if value is not None and str(value).strip() != "":
            return str(value).strip()
    return default


def config_from_env(role: str) -> dict[str, Any]:
    """Return connection config without printing or exposing passwords."""
    if role == "source":
        prefixes = ("OLD_MYSQL_", "SOURCE_MYSQL_", "MIGRATION_SOURCE_MYSQL_")
    elif role == "target":
        prefixes = ("NEW_MYSQL_", "TARGET_MYSQL_", "MYSQL_")
    else:
        raise ValueError("role must be 'source' or 'target'")
    return {
        "host": _first_env(prefixes, "HOST"),
        "port": int(_first_env(prefixes, "PORT", "3306")),
        "user": _first_env(prefixes, "USER"),
        "password": _first_env(prefixes, "PASSWORD"),
        "database": _first_env(prefixes, "DATABASE"),
        "charset": "utf8mb4",
        "connect_timeout": 15,
        "read_timeout": 120,
        "write_timeout": 120,
        "autocommit": False,
    }


def load_php_db_config(path: str | Path) -> dict[str, Any]:
    """Best-effort parser for common literal PHP DB config constants/arrays.

    It deliberately does not execute PHP. Dynamic getenv()/include-based configs must
    be entered in the form manually.
    """
    text = Path(path).expanduser().read_text(encoding="utf-8", errors="replace")
    aliases = {
        "host": ("DB_HOST", "MYSQL_HOST", "database_host", "db_host", "host"),
        "port": ("DB_PORT", "MYSQL_PORT", "database_port", "db_port", "port"),
        "user": ("DB_USER", "DB_USERNAME", "MYSQL_USER", "database_user", "db_user", "username", "user"),
        "password": ("DB_PASSWORD", "DB_PASS", "MYSQL_PASSWORD", "database_password", "db_password", "db_pass", "password", "pass"),
        "database": ("DB_NAME", "DB_DATABASE", "MYSQL_DATABASE", "database_name", "db_name", "dbname", "database", "name"),
    }
    result: dict[str, Any] = {}
    for field, names in aliases.items():
        for name in names:
            quoted_name = re.escape(name)
            # Matches define('DB_HOST', '...'), $db_host = '...', and 'host' => '...'.
            patterns = (
                rf"define\s*\(\s*['\"]{quoted_name}['\"]\s*,\s*(['\"])(.*?)\1\s*\)",
                rf"\$\s*{quoted_name}\s*=\s*(['\"])(.*?)\1\s*;",
                rf"['\"]{quoted_name}['\"]\s*=>\s*(['\"])(.*?)\1",
            )
            found = None
            for pattern in patterns:
                match = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
                if match:
                    found = match.group(2).strip()
                    break
            if found in (None, "") and field == "port":
                numeric_patterns = (
                    rf"define\s*\(\s*['\"]{quoted_name}['\"]\s*,\s*(\d+)\s*\)",
                    rf"\$\s*{quoted_name}\s*=\s*(\d+)\s*;",
                    rf"['\"]{quoted_name}['\"]\s*=>\s*(\d+)\b",
                )
                for pattern in numeric_patterns:
                    match = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
                    if match:
                        found = match.group(1).strip()
                        break
            if found not in (None, ""):
                result[field] = int(found) if field == "port" and found.isdigit() else found
                break
    return result


def quote_ident(name: str) -> str:
    if not isinstance(name, str) or not name or "\x00" in name:
        raise ValueError("Пустое или некорректное имя SQL-идентификатора.")
    return "`" + name.replace("`", "``") + "`"


def _connect(cfg: dict[str, Any]):
    try:
        import pymysql
    except ImportError as exc:
        raise RuntimeError("Для переноса установи зависимости: pip install -r requirements-admin-cli.txt") from exc
    required = ("host", "port", "user", "database")
    missing = [key for key in required if cfg.get(key) in (None, "")]
    if missing:
        raise RuntimeError("Не заполнены параметры подключения: " + ", ".join(missing))
    return pymysql.connect(**cfg)


def _fetchall(conn, sql: str, params=None):
    with conn.cursor() as cur:
        cur.execute(sql, params or ())
        return cur.fetchall()


def _table_names(conn) -> list[str]:
    rows = _fetchall(
        conn,
        "SELECT TABLE_NAME FROM information_schema.TABLES "
        "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME",
    )
    return [str(row[0]) for row in rows]


def _table_columns(conn, table: str) -> list[dict[str, Any]]:
    rows = _fetchall(conn, f"SHOW FULL COLUMNS FROM {quote_ident(table)}")
    result = []
    for row in rows:
        result.append({
            "name": row[0], "type": str(row[1]), "collation": row[2], "null": row[3],
            "key": row[4], "default": row[5], "extra": str(row[6] or ""),
            "comment": str(row[8] or "") if len(row) > 8 else "",
        })
    return result


def _show_create(conn, table: str) -> str:
    row = _fetchall(conn, f"SHOW CREATE TABLE {quote_ident(table)}")[0]
    return str(row[1])


def _column_definitions(create_sql: str) -> dict[str, str]:
    """Extract column clauses from MySQL's canonical SHOW CREATE TABLE output."""
    columns: dict[str, str] = {}
    for raw_line in create_sql.splitlines():
        line = raw_line.strip().rstrip(",").strip()
        match = re.match(r"^`((?:``|[^`])+)`\s+(.+)$", line)
        if not match:
            continue
        name = match.group(1).replace("``", "`")
        definition = match.group(2).strip()
        # This line pattern represents column definitions; index/constraint lines
        # in SHOW CREATE TABLE start with PRIMARY/UNIQUE/KEY/CONSTRAINT.
        columns[name] = definition
    return columns


def _table_engine(conn, table: str) -> str:
    rows = _fetchall(conn, "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s", (table,))
    return str(rows[0][0] or "").upper() if rows else ""


def _table_count(conn, table: str) -> int:
    rows = _fetchall(conn, f"SELECT COUNT(*) FROM {quote_ident(table)}")
    return int(rows[0][0])


def _is_required_without_default(column: dict[str, Any]) -> bool:
    extra = column["extra"].lower()
    return (
        str(column["null"]).upper() == "NO"
        and column["default"] is None
        and "auto_increment" not in extra
        and "generated" not in extra
    )


def _family(mysql_type: str) -> tuple[str, list[int]]:
    value = mysql_type.lower().strip()
    base_match = re.match(r"([a-z]+)\s*(?:\((.*?)\))?\s*(unsigned)?", value)
    if not base_match:
        return value, []
    base = base_match.group(1)
    nums = []
    args = base_match.group(2) or ""
    for part in args.split(","):
        try:
            nums.append(int(part.strip()))
        except ValueError:
            pass
    if "unsigned" in value:
        base += " unsigned"
    return base, nums


def _enum_values(mysql_type: str) -> set[str]:
    """Extract enum/set members from SHOW FULL COLUMNS type text."""
    return {
        item.replace("\\'", "'").replace("''", "'")
        for item in re.findall(r"'((?:\\.|[^'])*)'", mysql_type)
    }


def _compatible_type(source_type: str, target_type: str) -> bool:
    """Return whether all source type values fit the destination without conversion.

    An old ENUM may contain deprecated choices not present in the target schema.
    Whether this is safe depends on the actual stored rows and is checked in
    migrate_databases(); this helper remains conservative for such cases.
    """
    sb, sn = _family(source_type)
    tb, tn = _family(target_type)
    if sb in {"enum", "set"} or tb in {"enum", "set"}:
        if sb != tb:
            return False
        return _enum_values(source_type) <= _enum_values(target_type)
    if sb == tb:
        if sb.startswith(("varchar", "char", "varbinary", "binary")) or sb in {"decimal", "numeric"}:
            if len(sn) >= 1 and len(tn) >= 1 and tn[0] < sn[0]:
                return False
            if sb in {"decimal", "numeric"} and len(sn) >= 2 and len(tn) >= 2 and tn[1] < sn[1]:
                return False
        return True
    # A wider character family can safely receive a narrower source family.
    character_capacity = {"tinytext": 255, "text": 65535, "mediumtext": 16777215, "longtext": 4294967295}
    if sb in {"varchar", "char"} and tb in character_capacity:
        return not sn or sn[0] <= character_capacity[tb]
    # INT widths share the same storage/value family only when destination can hold source.
    integer_ranges = {
        "tinyint": 1, "smallint": 2, "mediumint": 3, "int": 4, "integer": 4, "bigint": 5,
        "tinyint unsigned": 1, "smallint unsigned": 2, "mediumint unsigned": 3,
        "int unsigned": 4, "integer unsigned": 4, "bigint unsigned": 5,
    }
    if sb in integer_ranges and tb in integer_ranges:
        return integer_ranges[tb] >= integer_ranges[sb] and ("unsigned" in sb) == ("unsigned" in tb)
    if sb in {"text", "tinytext", "mediumtext", "longtext"} and tb in character_capacity:
        source_capacity = character_capacity.get(sb, 0)
        if tb in character_capacity:
            return character_capacity[tb] >= source_capacity
    return False


def _enum_data_values(conn, table: str, column: str) -> set[str]:
    """Read distinct non-NULL enum values without logging record contents."""
    rows = _fetchall(conn, f"SELECT DISTINCT {quote_ident(column)} FROM {quote_ident(table)} WHERE {quote_ident(column)} IS NOT NULL")
    return {str(row[0]) for row in rows}


def _count_column_value(conn, table: str, column: str, value: Any) -> int:
    rows = _fetchall(conn, f"SELECT COUNT(*) FROM {quote_ident(table)} WHERE {quote_ident(column)} = %s", (value,))
    return int(rows[0][0])


def _database_identity(cfg: dict[str, Any]) -> tuple[str, int, str]:
    return (str(cfg.get("host", "")).lower().rstrip("."), int(cfg.get("port", 3306)), str(cfg.get("database", "")))


def migrate_databases(
    source_cfg: dict[str, Any],
    target_cfg: dict[str, Any],
    *,
    apply: bool = False,
    batch_size: int = 500,
    progress: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """Plan or perform a full table-data migration. apply=True replaces rows in target tables with source rows."""
    log = progress or (lambda message: None)
    if batch_size < 1 or batch_size > 10000:
        raise ValueError("batch_size должен быть от 1 до 10000")
    if _database_identity(source_cfg) == _database_identity(target_cfg):
        raise RuntimeError("Источник и целевая БД совпадают. Перенос остановлен для защиты данных.")

    source = _connect(source_cfg)
    target = None
    try:
        target = _connect(target_cfg)
        source_tables = _table_names(source)
        target_tables = _table_names(target)
        if not source_tables:
            raise RuntimeError("В исходной БД не найдено таблиц для переноса.")

        target_set = set(target_tables)
        report: dict[str, Any] = {
            "source_database": source_cfg["database"], "target_database": target_cfg["database"],
            "source_tables": len(source_tables), "target_tables_before": len(target_tables),
            "missing_tables": [t for t in source_tables if t not in target_set],
            "target_only_tables": [t for t in target_tables if t not in set(source_tables)],
            "tables": [], "enum_value_mappings": [], "schema_differences": [], "applied": False,
        }
        errors: list[str] = []
        # Explicit compatibility conversion for settings removed from the current UI.
        # The old `system` appearance option was removed; new installations default to dark.
        value_mappings: dict[str, dict[str, dict[str, str]]] = {}
        source_columns: dict[str, list[dict[str, Any]]] = {}
        target_columns: dict[str, list[dict[str, Any]]] = {}
        source_rows: dict[str, int] = {}

        log(f"Источник: {source_cfg['database']} ({source_cfg['host']}:{source_cfg['port']})")
        log(f"Целевая БД: {target_cfg['database']} ({target_cfg['host']}:{target_cfg['port']})")
        log(f"В исходной БД таблиц: {len(source_tables)}; в целевой до переноса: {len(target_tables)}")
        if report["missing_tables"]:
            log("Будут созданы отсутствующие таблицы: " + ", ".join(report["missing_tables"]))
        if report["target_only_tables"]:
            log("Таблицы только в целевой БД останутся нетронутыми: " + ", ".join(report["target_only_tables"]))

        for table in source_tables:
            source_columns[table] = _table_columns(source, table)
            count = _table_count(source, table)
            source_rows[table] = count
            row_info: dict[str, Any] = {"table": table, "source_rows": count, "target_rows_before": None}
            if table not in target_set:
                row_info["action"] = "create table and copy"
                source_engine = _table_engine(source, table)
                if source_engine and source_engine not in {"INNODB", "NDBCLUSTER"}:
                    errors.append(f"{table}: исходная таблица использует {source_engine}; безопасный откат целевой миграции не гарантирован")
            else:
                target_columns[table] = _table_columns(target, table)
                row_info["target_rows_before"] = _table_count(target, table)
                source_names = {c["name"] for c in source_columns[table]}
                target_names = {c["name"] for c in target_columns[table]}
                missing_columns = [c for c in source_columns[table] if c["name"] not in target_names]
                row_info["columns_to_add"] = [c["name"] for c in missing_columns]
                if missing_columns:
                    row_info["action"] = "add missing columns and copy"
                else:
                    row_info["action"] = "replace rows"
                for sc in source_columns[table]:
                    tc = next((c for c in target_columns[table] if c["name"] == sc["name"]), None)
                    if not tc or _compatible_type(sc["type"], tc["type"]):
                        continue
                    source_family, _ = _family(sc["type"])
                    target_family, _ = _family(tc["type"])
                    if source_family == target_family == "enum":
                        source_members = _enum_values(sc["type"])
                        target_members = _enum_values(tc["type"])
                        actual_values = _enum_data_values(source, table, sc["name"])
                        unsupported_values = actual_values - target_members
                        if not unsupported_values:
                            difference = (f"{table}.{sc['name']}: исходная ENUM-схема содержит устаревшие варианты "
                                          f"{sorted(source_members - target_members)}, но строки используют только "
                                          "значения, разрешённые новой схемой.")
                            report["schema_differences"].append(difference)
                            log("  СОВМЕСТИМОЕ ИЗМЕНЕНИЕ СХЕМЫ: " + difference)
                            continue
                        # Known project migration: the former 'system' appearance choice
                        # was removed. Map stored legacy values to the target's dark default.
                        if (table, sc["name"]) == ("user_settings", "appearance") and "dark" in target_members:
                            map_for_column = {value: "dark" for value in unsupported_values if value == "system"}
                            unmapped = unsupported_values - set(map_for_column)
                            if map_for_column and not unmapped:
                                value_mappings.setdefault(table, {})[sc["name"]] = map_for_column
                                for old_value, new_value in sorted(map_for_column.items()):
                                    count_value = _count_column_value(source, table, sc["name"], old_value)
                                    detail = {
                                        "table": table, "column": sc["name"], "from": old_value,
                                        "to": new_value, "rows": count_value,
                                        "reason": "Опция темы system удалена; применяется текущая тема по умолчанию dark.",
                                    }
                                    report["enum_value_mappings"].append(detail)
                                    log(f"  ПРЕОБРАЗОВАНИЕ ЗНАЧЕНИЙ: {table}.{sc['name']}: "
                                        f"{old_value!r} → {new_value!r} для {count_value} строк "
                                        "(старый вариант темы system удалён).")
                                continue
                        errors.append(
                            f"{table}.{sc['name']}: тип источника {sc['type']} не совместим с целевым {tc['type']}; "
                            f"в данных источника есть неподдерживаемые значения {sorted(unsupported_values)}"
                        )
                    else:
                        errors.append(f"{table}.{sc['name']}: тип источника {sc['type']} не совместим с целевым {tc['type']}")
                for tc in target_columns[table]:
                    if tc["name"] not in source_names and count and _is_required_without_default(tc):
                        errors.append(f"{table}.{tc['name']}: в целевой БД обязательный столбец отсутствует в источнике и не имеет DEFAULT")
                # Transactional replacement is required to preserve the target's old rows on failure.
                engine = _table_engine(target, table)
                if engine and engine not in {"INNODB", "NDBCLUSTER"}:
                    errors.append(f"{table}: целевая таблица использует {engine}; безопасный откат данных не гарантирован")
            report["tables"].append(row_info)
            log(f"  {table}: источник {count} строк; цель до переноса {row_info['target_rows_before'] if row_info['target_rows_before'] is not None else 'таблицы нет'}")

        if errors:
            report["errors"] = errors
            log("ПРЕДВАРИТЕЛЬНАЯ ПРОВЕРКА НЕ ПРОЙДЕНА:")
            for error in errors:
                log("  - " + error)
            raise RuntimeError("Найдены несовместимости схемы. Данные целевой БД не изменены; см. отчёт выше.")

        if not apply:
            log("Предварительная проверка завершена. Данные не изменялись.")
            report["source_rows_total"] = sum(source_rows.values())
            report["applied"] = False
            return report

        # Schema changes only add missing source tables/columns; no destination tables are dropped.
        # Disable FK checks while creating missing related tables so alphabetic order is harmless.
        log("Подготовка схемы целевой БД…")
        with target.cursor() as cur:
            cur.execute("SET FOREIGN_KEY_CHECKS=0")
        try:
            for table in source_tables:
                if table not in target_set:
                    create_sql = _show_create(source, table)
                    with target.cursor() as cur:
                        cur.execute(create_sql)
                    target.commit()
                    target_set.add(table)
                    log(f"  Создана таблица {table}")
                    target_columns[table] = _table_columns(target, table)
                else:
                    source_defs = _column_definitions(_show_create(source, table))
                    target_names = {c["name"] for c in _table_columns(target, table)}
                    for col in source_columns[table]:
                        name = col["name"]
                        if name not in target_names:
                            definition = source_defs.get(name)
                            if not definition:
                                raise RuntimeError(f"Не удалось извлечь DDL столбца {table}.{name} из SHOW CREATE TABLE")
                            with target.cursor() as cur:
                                cur.execute(f"ALTER TABLE {quote_ident(table)} ADD COLUMN {quote_ident(name)} {definition}")
                            target.commit()
                            target_names.add(name)
                            log(f"  Добавлен столбец {table}.{name}")
                    target_columns[table] = _table_columns(target, table)
        finally:
            try:
                with target.cursor() as cur:
                    cur.execute("SET FOREIGN_KEY_CHECKS=1")
            except Exception:
                pass

        # Recheck required destination-only columns after all schema additions, before deleting rows.
        for table in source_tables:
            s_names = {c["name"] for c in source_columns[table]}
            for tc in target_columns[table]:
                if tc["name"] not in s_names and source_rows[table] and _is_required_without_default(tc):
                    raise RuntimeError(f"После подготовки схемы {table}.{tc['name']} требует данные, которых нет в источнике. Таблицы созданы/расширены, но строки ещё не очищались.")

        # Delete and refill inside one transaction (all target tables must be transactional).
        with target.cursor() as cur:
            cur.execute("SET FOREIGN_KEY_CHECKS=0")
        try:
            target.begin()
            with target.cursor() as cur:
                for table in source_tables:
                    cur.execute(f"DELETE FROM {quote_ident(table)}")
            log("Существующие строки в таблицах-источниках очищены в транзакции; копирование начато…")

            try:
                import pymysql
            except ImportError as exc:
                raise RuntimeError("Для переноса требуется PyMySQL из requirements.txt") from exc
            copied_by_table: dict[str, int] = {}
            for table in source_tables:
                target_names = {c["name"] for c in target_columns[table]}
                insert_columns = [c["name"] for c in source_columns[table]
                                  if c["name"] in target_names and "generated" not in c["extra"].lower()]
                copied = 0
                if insert_columns:
                    cols_sql = ", ".join(quote_ident(c) for c in insert_columns)
                    placeholders = ", ".join(["%s"] * len(insert_columns))
                    insert_sql = f"INSERT INTO {quote_ident(table)} ({cols_sql}) VALUES ({placeholders})"
                    select_sql = f"SELECT {cols_sql} FROM {quote_ident(table)}"
                    with source.cursor(pymysql.cursors.SSCursor) as src_cur:
                        src_cur.execute(select_sql)
                        with target.cursor() as dst_cur:
                            while True:
                                rows = src_cur.fetchmany(batch_size)
                                if not rows:
                                    break
                                # Transform explicitly recognized legacy enum values while
                                # preserving every other source value.
                                column_mappings = value_mappings.get(table, {})
                                if column_mappings:
                                    name_to_index = {name: index for index, name in enumerate(insert_columns)}
                                    changed_rows = []
                                    for row in rows:
                                        mutable = list(row)
                                        for column_name, mapping in column_mappings.items():
                                            index = name_to_index.get(column_name)
                                            if index is not None and mutable[index] is not None:
                                                mutable[index] = mapping.get(str(mutable[index]), mutable[index])
                                        changed_rows.append(tuple(mutable))
                                    rows = changed_rows
                                dst_cur.executemany(insert_sql, rows)
                                copied += len(rows)
                elif source_rows[table]:
                    # Rare table whose columns are all generated; insert an empty row per source record.
                    with target.cursor() as dst_cur:
                        for _ in range(source_rows[table]):
                            dst_cur.execute(f"INSERT INTO {quote_ident(table)} () VALUES ()")
                            copied += 1
                copied_by_table[table] = copied
                log(f"  {table}: перенесено {copied} строк из {source_rows[table]}")
                if copied != source_rows[table]:
                    raise RuntimeError(f"Проверка количества строк не прошла для таблицы {table}: {copied} != {source_rows[table]}")
            target.commit()
        except Exception:
            target.rollback()
            raise
        finally:
            try:
                with target.cursor() as cur:
                    cur.execute("SET FOREIGN_KEY_CHECKS=1")
            except Exception:
                pass

        # Validate row counts after the commit.
        mismatches = []
        for table in source_tables:
            actual = _table_count(target, table)
            if actual != source_rows[table]:
                mismatches.append(f"{table}: источник {source_rows[table]}, цель {actual}")
        if mismatches:
            report["verification_errors"] = mismatches
            raise RuntimeError("Данные записаны, но проверка количества строк выявила расхождения: " + "; ".join(mismatches))

        report["source_rows_total"] = sum(source_rows.values())
        report["copied_rows_total"] = sum(source_rows.values())
        report["applied"] = True
        log(f"УСПЕШНО: перенесено {report['copied_rows_total']} строк в {len(source_tables)} таблиц.")
        log("Проверка количества строк по каждой таблице пройдена.")
        return report
    finally:
        try:
            source.close()
        except Exception:
            pass
        if target is not None:
            try:
                target.close()
            except Exception:
                pass


def _apply_overrides(cfg: dict[str, Any], args, prefix: str) -> dict[str, Any]:
    result = dict(cfg)
    for field in ("host", "port", "user", "password", "database"):
        value = getattr(args, f"{prefix}_{field}", None)
        if value is not None and value != "":
            result[field] = int(value) if field == "port" else value
    return result


def _config_is_complete(cfg: dict[str, Any]) -> bool:
    return all(cfg.get(field) not in (None, "") for field in ("host", "user", "database"))


def _plain_mysql_env_config() -> dict[str, Any]:
    """Read the currently configured MYSQL_* connection for migration source fallback."""
    return {
        "host": os.getenv("MYSQL_HOST", "").strip(),
        "port": int(os.getenv("MYSQL_PORT", "3306") or 3306),
        "user": os.getenv("MYSQL_USER", "").strip(),
        "password": os.getenv("MYSQL_PASSWORD", ""),
        "database": os.getenv("MYSQL_DATABASE", "").strip(),
        "charset": "utf8mb4", "connect_timeout": 15,
        "read_timeout": 120, "write_timeout": 120, "autocommit": False,
    }


def run_migration_args(args) -> int:
    """Run the cross-host database copy without GUI or interactive credential prompts."""
    source_cfg = config_from_env("source")
    target_cfg = config_from_env("target")

    source_php = getattr(args, "source_php_config", None)
    target_php = getattr(args, "target_php_config", None)
    if source_php:
        source_cfg.update(load_php_db_config(source_php))
    if target_php:
        target_cfg.update(load_php_db_config(target_php))

    target_overridden = any(getattr(args, f"target_{field}", None) not in (None, "") for field in ("host", "port", "user", "password", "database"))

    # Typical one-host setup: MYSQL_* points at the currently used DB, while
    # --target-* (or target-php-config) describes the new host. In that case
    # use MYSQL_* as source and never silently treat the same DB as both ends.
    current_cfg = _plain_mysql_env_config()
    if not _config_is_complete(source_cfg) and not source_php and _config_is_complete(current_cfg) and _config_is_complete(target_cfg):
        source_cfg = current_cfg

    source_cfg = _apply_overrides(source_cfg, args, "source")
    target_cfg = _apply_overrides(target_cfg, args, "target")

    if not _config_is_complete(source_cfg):
        missing = [key for key in ("host", "user", "database") if source_cfg.get(key) in (None, "")]
        raise RuntimeError("Не настроено подключение ИСТОЧНИКА: " + ", ".join(missing) + ". Используй OLD_MYSQL_*/SOURCE_MYSQL_* или --source-*.")
    if not _config_is_complete(target_cfg):
        missing = [key for key in ("host", "user", "database") if target_cfg.get(key) in (None, "")]
        raise RuntimeError("Не настроено подключение НАЗНАЧЕНИЯ: " + ", ".join(missing) + ". Используй NEW_MYSQL_*/TARGET_MYSQL_*, MYSQL_* или --target-*.")
    if _database_identity(source_cfg) == _database_identity(target_cfg):
        raise RuntimeError("Источник и целевая БД совпадают. Проверь host, port и database.")

    if args.apply:
        expected = str(getattr(args, "confirm_target_db", "") or "")
        if expected != str(target_cfg["database"]):
            raise RuntimeError("Для изменения данных обязательно укажи --confirm-target-db с ТОЧНЫМ именем целевой БД.")
        print("ВНИМАНИЕ: все строки одноимённых таблиц целевой БД будут заменены строками источника.")
        print("Таблицы, существующие только в целевой БД, останутся нетронутыми.")

    result = migrate_databases(
        source_cfg,
        target_cfg,
        apply=bool(args.apply),
        batch_size=int(args.batch_size),
        progress=print,
    )
    if args.report_json:
        report_path = Path(args.report_json).expanduser().resolve()
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
        print(f"JSON-отчёт: {report_path}")
    if not args.apply:
        print("\nРежим проверки: целевая БД не изменена.")
        print("Для выполнения добавь --apply --confirm-target-db", target_cfg["database"])
    return 0


def _add_actor(parser):
    parser.add_argument("--actor-id", type=int, default=None, help="Telegram ID администратора для admin_logs; по умолчанию первый ADMIN_IDS")
    return parser


def _build_parser():
    parser = argparse.ArgumentParser(
        description="Basalt Perfume WebApp — независимая консольная админка и перенос MySQL/MariaDB",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--version", action="version", version=f"Basalt Perfume admin-cli {__version__}")
    parser.add_argument("--env-file", default=str(Path(__file__).resolve().parent / ".env"), help="Файл с MYSQL_* и KEY_ENCRYPTION_SECRET")
    parser.add_argument("--php-config", default=None, help="PHP config/database.php для обычных команд БД")
    parser.add_argument("--db-host", default=None, help="Переопределить MYSQL_HOST")
    parser.add_argument("--db-port", type=int, default=None, help="Переопределить MYSQL_PORT")
    parser.add_argument("--db-user", default=None, help="Переопределить MYSQL_USER")
    parser.add_argument("--db-password", default=None, help="Переопределить MYSQL_PASSWORD (лучше использовать .env)")
    parser.add_argument("--db-name", default=None, help="Переопределить MYSQL_DATABASE")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("db-info", help="Проверить соединение и показать сервер/БД")
    sub.add_parser("stats", help="Сводка по пользователям, подпискам, прайсам, товарам и настройкам")
    sub.add_parser("tables", help="Список таблиц и их примерный размер")

    users = sub.add_parser("users", help="Список и фильтрация пользователей")
    users.add_argument("--role", choices=("admin", "seller", "buyer", "none"))
    users.add_argument("--status", choices=("all", "active", "blocked"), default="all")
    users.add_argument("--search", default="", help="Поиск по Telegram ID, username или имени")
    users.add_argument("--limit", type=int, default=50)
    user = sub.add_parser("user", help="Подробная информация о пользователе, прайс-листах и подписках")
    user.add_argument("user_id", type=int)
    favorites = sub.add_parser("favorites", help="Показать актуальное избранное пользователя")
    favorites.add_argument("user_id", type=int)
    favorites.add_argument("--limit", type=int, default=100)

    role = sub.add_parser("set-role", help="Изменить роль пользователя")
    role.add_argument("user_id", type=int)
    role.add_argument("role", choices=("admin", "seller", "buyer", "none"))
    _add_actor(role)
    block = sub.add_parser("block", help="Временно или бессрочно заблокировать пользователя")
    block.add_argument("user_id", type=int)
    block.add_argument("--reason", required=True)
    block.add_argument("--details", default="")
    ban_duration = block.add_mutually_exclusive_group(required=True)
    ban_duration.add_argument("--until", default=None, help="YYYY-MM-DD HH:MM[:SS]")
    ban_duration.add_argument("--minutes", type=int, default=0, help="Срок временной блокировки")
    ban_duration.add_argument("--hours", type=int, default=0, help="Срок временной блокировки")
    ban_duration.add_argument("--days", type=int, default=0, help="Срок временной блокировки")
    ban_duration.add_argument("--permanent", action="store_true")
    _add_actor(block)
    unblock = sub.add_parser("unblock", help="Снять блокировку пользователя")
    unblock.add_argument("user_id", type=int)
    _add_actor(unblock)
    delete_user = sub.add_parser("delete-user", help="Удалить профиль и связанные записи WebApp из БД")
    delete_user.add_argument("user_id", type=int)
    delete_user.add_argument("--confirm", required=True, help="Повтори Telegram ID для подтверждения")
    _add_actor(delete_user)

    extend = sub.add_parser("extend-subscription", help="Продлить активный сегмент и сдвинуть очередь продлений")
    extend.add_argument("user_id", type=int)
    extend.add_argument("amount", type=int)
    extend.add_argument("unit", choices=("hours", "days", "months"))
    _add_actor(extend)
    keys = sub.add_parser("keys", help="Список ключей активации с фильтрами")
    keys.add_argument("--status", choices=("all", "free", "used", "active", "queued", "expired", "frozen"), default="all")
    keys.add_argument("--role", choices=("buyer", "seller", "admin"))
    keys.add_argument("--limit", type=int, default=50)
    key = sub.add_parser("key", help="Показать ключ; --reveal выводит полный код после проверки HMAC и SHA-256")
    key.add_argument("key_id", type=int)
    key.add_argument("--reveal", action="store_true")
    gen = sub.add_parser("generate-keys", help="Создать ключи в БД с ролью и сроком, вывести plaintext один раз")
    gen.add_argument("--count", type=int, default=10)
    gen.add_argument("--days", type=int, default=30)
    gen.add_argument("--role", choices=("buyer", "seller", "admin"), default="buyer")
    gen.add_argument("--out-file", default=None, help="Опционально сохранить открытые ключи в локальный файл")
    _add_actor(gen)
    disable = sub.add_parser("disable-key", help="Отключить свободный ключ активации")
    disable.add_argument("key_id", type=int)
    _add_actor(disable)
    assign = sub.add_parser("assign-key", help="Назначить свободный ключ пользователю и синхронизировать роль")
    assign.add_argument("user_id", type=int)
    assign.add_argument("key_id", type=int)
    _add_actor(assign)

    price_lists = sub.add_parser("price-lists", help="Список прайс-листов с владельцами и числом строк/товаров")
    price_lists.add_argument("--user-id", type=int)
    price_lists.add_argument("--status", default=None)
    price_lists.add_argument("--limit", type=int, default=50)
    delete_price_list = sub.add_parser("delete-price-list", help="Удалить прайс-лист и связанные строки/товары из БД")
    delete_price_list.add_argument("price_list_id", type=int)
    delete_price_list.add_argument("--confirm", required=True, help="Повтори ID прайс-листа для подтверждения")
    _add_actor(delete_price_list)

    uploads = sub.add_parser("uploads", help="Просмотр очереди загрузок WebApp")
    uploads.add_argument("--status", choices=("pending", "processing", "done", "error"), default=None)
    uploads.add_argument("--limit", type=int, default=50)
    retry = sub.add_parser("retry-upload", help="Вернуть ошибочную веб-загрузку в очередь Worker")
    retry.add_argument("job_id", type=int)
    _add_actor(retry)
    errors = sub.add_parser("errors", help="Список ошибок разбора прайс-листов")
    errors.add_argument("--user-id", type=int)
    errors.add_argument("--limit", type=int, default=50)
    logs = sub.add_parser("logs", help="Журнал действий администраторов")
    logs.add_argument("--actor", type=int, default=None, help="Фильтр по Telegram ID администратора")
    logs.add_argument("--action", default=None, help="Подстрока действия")
    logs.add_argument("--limit", type=int, default=100)

    sub.add_parser("settings", help="Показать все app_settings")
    set_setting = sub.add_parser("set-setting", help="Создать или изменить произвольную app_settings запись")
    set_setting.add_argument("key")
    set_setting.add_argument("value")
    _add_actor(set_setting)
    browser = sub.add_parser("browser-access", help="Управление доступом из обычного браузера и синхронизацией сессий")
    browser_mode = browser.add_mutually_exclusive_group(required=True)
    browser_mode.add_argument("--enable", action="store_true")
    browser_mode.add_argument("--disable", action="store_true")
    browser.add_argument("--session-sync", choices=("keep", "enable", "disable"), default="keep")
    _add_actor(browser)
    maintenance = sub.add_parser("maintenance", help="Включить/выключить технические работы")
    maintenance_mode = maintenance.add_mutually_exclusive_group(required=True)
    maintenance_mode.add_argument("--enable", action="store_true")
    maintenance_mode.add_argument("--disable", action="store_true")
    maintenance.add_argument("--title", default="Технические работы")
    maintenance.add_argument("--message", default="Сервис временно недоступен. Попробуйте позже.")
    maintenance.add_argument("--until", default="", help="Обязательная будущая дата при --enable: YYYY-MM-DD HH:MM[:SS]")
    _add_actor(maintenance)
    announce = sub.add_parser("announce", help="Создать in-app уведомление пользователям с включёнными обновлениями")
    announce.add_argument("--title", required=True)
    announce.add_argument("--message", required=True)
    _add_actor(announce)

    clean = sub.add_parser("clean-cache", help="Удалить __pycache__/__cache__ в выбранном каталоге")
    clean.add_argument("--root", default=None, help="Каталог; по умолчанию каталог admin-cli.py")

    migration = sub.add_parser("migrate-db", help="Проверить или перенести все базовые таблицы/данные из одной MySQL БД в другую")
    for prefix, label in (("source", "источника"), ("target", "назначения")):
        migration.add_argument(f"--{prefix}-host", default=None, help=f"Хост БД {label}")
        migration.add_argument(f"--{prefix}-port", type=int, default=None, help=f"Порт БД {label}")
        migration.add_argument(f"--{prefix}-user", default=None, help=f"Пользователь БД {label}")
        migration.add_argument(f"--{prefix}-password", default=None, help=f"Пароль БД {label}; предпочтительно через .env")
        migration.add_argument(f"--{prefix}-database", default=None, help=f"Имя БД {label}")
    migration.add_argument("--source-php-config", default=None, help="PHP config/database.php источника (литеральные значения)")
    migration.add_argument("--target-php-config", default=None, help="PHP config/database.php назначения (литеральные значения)")
    migration.add_argument("--apply", action="store_true", help="Выполнить перенос; без флага только проверка")
    migration.add_argument("--confirm-target-db", default="", help="Точное имя целевой БД для подтверждения --apply")
    migration.add_argument("--batch-size", type=int, default=500, help="Строк в одном пакете (1..10000)")
    migration.add_argument("--report-json", default=None, help="Сохранить JSON-отчёт")
    return parser


def main(argv=None):
    parser = _build_parser()
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        parser.print_help()
        return 0
    args = parser.parse_args(argv)
    try:
        env_file = Path(args.env_file).expanduser()
        if env_file.is_file():
            try:
                from dotenv import load_dotenv
                load_dotenv(env_file, override=False)
            except ImportError:
                # Keep a small fallback parser so the admin utility can run without python-dotenv.
                for raw in env_file.read_text(encoding="utf-8").splitlines():
                    line = raw.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    name, value = line.split("=", 1)
                    name, value = name.strip(), value.strip().strip('"').strip("'")
                    if name and name.replace("_", "A").isalnum():
                        os.environ.setdefault(name, value)
        if args.command == "clean-cache":
            root = Path(args.root).expanduser().resolve() if args.root else Path(__file__).resolve().parent
            count = _clean_cache_directories(root)
            print(f"Удалено папок кэша: {count}")
            return 0
        if args.command == "migrate-db":
            return run_migration_args(args)
        return _db_command(args)
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        print("ERROR:", exc, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
