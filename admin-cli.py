#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CLI-администрирование Basalt Perfume и локальная генерация ключей.

Поддерживает команды управления БД, безопасную миграцию MySQL/MariaDB,
очистку кэша и генерацию SQL/TXT ключей активации. Запуск без аргументов
показывает справку; подробности команд доступны через --help.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import getpass
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
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except Exception:
    pass

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


def generate_records(secret: str, duration_days: int):
    records = []
    for role in ("buyer", "seller", "admin"):
        for _ in range(2):
            plain = "BP-" + role.upper() + "-" + "-".join(_random_group() for _ in range(4))
            records.append({
                "role": role,
                "plain": plain,
                "hash": hashlib.sha256(plain.encode("utf-8")).hexdigest(),
                "prefix": "ROLE-" + role.upper(),
                "ciphertext": _encrypt_key(plain, secret),
                "duration_days": duration_days,
            })
    return records


def build_sql(records):
    lines = [
        "-- Basalt Perfume: role-assigned activation keys (generated locally)",
        "-- Import this file using phpMyAdmin -> database -> Import.",
        "-- The ciphertext uses KEY_ENCRYPTION_SECRET provided in the generator.",
        "-- Safe to import this exact file more than once: key_hash is checked before insertion.",
        "",
        "SET @role_activation_column_count = (",
        "  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS",
        "  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscription_keys' AND COLUMN_NAME = 'role_on_activate'",
        ");",
        "SET @role_activation_sql = IF(",
        "  @role_activation_column_count = 0,",
        "  'ALTER TABLE subscription_keys ADD COLUMN role_on_activate VARCHAR(10) NULL DEFAULT NULL AFTER duration_days',",
        "  'SELECT 1'",
        ");",
        "PREPARE role_activation_stmt FROM @role_activation_sql;",
        "EXECUTE role_activation_stmt;",
        "DEALLOCATE PREPARE role_activation_stmt;",
        "",
        "START TRANSACTION;",
    ]
    for r in records:
        # All values here are generated by this script and constrained to safe ASCII.
        lines.extend([
            "INSERT INTO subscription_keys (key_hash, key_prefix, key_ciphertext, usable, duration_days, role_on_activate)",
            "SELECT '{hash}', '{prefix}', '{ciphertext}', 1, {days}, '{role}' FROM DUAL".format(
                hash=r["hash"], prefix=r["prefix"], ciphertext=r["ciphertext"],
                days=r["duration_days"], role=r["role"]),
            "WHERE NOT EXISTS (SELECT 1 FROM subscription_keys WHERE key_hash = '{hash}');".format(hash=r["hash"]),
            "",
        ])
    lines.extend([
        "COMMIT;",
        "",
        "-- After import, verify: SELECT key_prefix, role_on_activate, duration_days, usable FROM subscription_keys WHERE role_on_activate IN ('buyer','seller','admin') ORDER BY role_on_activate;",
    ])
    return "\n".join(lines) + "\n"


def build_plaintext(records):
    lines = [
        "BASALT PERFUME — КЛЮЧИ АКТИВАЦИИ С НАЗНАЧЕНИЕМ РОЛИ",
        "Срок каждого ключа: {} дн.".format(records[0]["duration_days"] if records else "—"),
        "",
        "Храните этот файл безопасно. Административные ключи предоставляют роль ADMIN.",
        "Ключи меняют роль только когда текущая роль пользователя — none, согласно логике WebApp/бота.",
        "",
    ]
    for role in ("buyer", "seller", "admin"):
        lines.append(role.upper())
        for rec in records:
            if rec["role"] == role:
                lines.append("  " + rec["plain"])
        lines.append("")
    lines.append("SQL с зашифрованными значениями создан отдельно. Не помещайте эти открытые ключи в публичные чаты.")
    return "\n".join(lines) + "\n"


def _self_test():
    # FIPS-197 AES-256 known-answer test.
    key = bytes.fromhex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
    block = bytes.fromhex("00112233445566778899aabbccddeeff")
    expected = "8ea2b7ca516745bfeafc49904b496089"
    actual = _aes256_encrypt_block(block, _expand_aes256_key(key)).hex()
    if actual != expected:
        raise RuntimeError("Внутренняя проверка AES не прошла. Файлы не создавались.")


async def _db_command(args):
    try:
        import aiomysql
        from bot.config import settings
    except Exception as exc:
        raise RuntimeError("Для команд управления БД запусти файл из корня проекта бота с установленными зависимостями и настроенным .env: " + str(exc))

    cfg = {
        "host": args.db_host or settings.mysql_host,
        "port": args.db_port or settings.mysql_port,
        "user": args.db_user or settings.mysql_user,
        "password": args.db_password if args.db_password is not None else settings.mysql_password,
        "db": args.db_name or settings.mysql_database,
        "charset": "utf8mb4",
        "autocommit": False,
        "connect_timeout": 10,
    }
    if not cfg["user"] or not cfg["db"]:
        raise RuntimeError("Не заданы MYSQL_USER / MYSQL_DATABASE в .env или аргументах CLI.")
    if getattr(args, "actor_id", None) is None:
        args.actor_id = (settings.admin_ids[0] if getattr(settings, "admin_ids", ()) else None)
    conn = await aiomysql.connect(**cfg)
    try:
        async with conn.cursor() as cur:
            if args.command == "stats":
                for table in ("users", "subscription_keys", "price_lists", "products", "app_notifications", "admin_user_deletion_queue"):
                    try:
                        await cur.execute(f"SELECT COUNT(*) FROM `{table}`")
                        print(f"{table}: {(await cur.fetchone())[0]}")
                    except Exception as exc:
                        print(f"{table}: недоступна ({exc})")
                await cur.execute("SELECT setting_value FROM app_settings WHERE setting_key='maintenance_mode' LIMIT 1")
                row = await cur.fetchone()
                print("maintenance_mode:", row[0] if row else "0")
            elif args.command == "users":
                sql = "SELECT tg_id,username,first_name,last_name,role,is_blocked,banned_until FROM users"
                params = []
                if args.role:
                    sql += " WHERE role=%s"; params.append(args.role)
                sql += " ORDER BY created_at DESC LIMIT %s"; params.append(max(1, min(args.limit, 500)))
                await cur.execute(sql, params)
                rows = await cur.fetchall()
                print("TG_ID | ROLE | BLOCKED | USERNAME | NAME | BANNED_UNTIL")
                for r in rows:
                    print(f"{r[0]} | {r[4]} | {r[5]} | @{r[1] or '-'} | {' '.join(x for x in (r[2],r[3]) if x) or '-'} | {r[6] or '-'}")
            elif args.command == "set-role":
                await cur.execute("SELECT role FROM users WHERE tg_id=%s LIMIT 1", (args.user_id,))
                target = await cur.fetchone()
                if not target: raise RuntimeError("Пользователь не найден.")
                await cur.execute("SELECT 1 FROM admins WHERE tg_id=%s LIMIT 1", (args.user_id,))
                in_admin_table = await cur.fetchone() is not None
                is_configured_admin = args.user_id in getattr(settings, "admin_ids", ())
                is_admin_target = in_admin_table or is_configured_admin or str(target[0]).lower() == "admin"
                if is_admin_target and args.role != "admin": raise RuntimeError("Нельзя изменить роль защищённого профиля администратора.")
                await cur.execute("UPDATE users SET role=%s WHERE tg_id=%s", (args.role, args.user_id))
                if cur.rowcount != 1 and str(target[0]).lower() != args.role: raise RuntimeError("Не удалось изменить роль.")
                if args.role == "admin": await cur.execute("INSERT IGNORE INTO admins(tg_id) VALUES(%s)", (args.user_id,))
                elif not is_configured_admin: await cur.execute("DELETE FROM admins WHERE tg_id=%s", (args.user_id,))
                await conn.commit(); print("Роль обновлена.")
            elif args.command == "block":
                await cur.execute("SELECT u.role,EXISTS(SELECT 1 FROM admins a WHERE a.tg_id=u.tg_id) FROM users u WHERE u.tg_id=%s LIMIT 1", (args.user_id,))
                target = await cur.fetchone()
                if not target: raise RuntimeError("Пользователь не найден.")
                if args.user_id in getattr(settings, "admin_ids", ()) or bool(target[1]) or str(target[0]).lower() == "admin": raise RuntimeError("Нельзя блокировать защищённый профиль администратора.")
                until = None if args.permanent else args.until
                if not args.permanent and not until: raise RuntimeError("Укажи --until 'YYYY-MM-DD HH:MM:SS' либо --permanent.")
                await cur.execute("UPDATE users SET is_blocked=1,banned_until=%s,ban_reason=%s,ban_details=%s WHERE tg_id=%s", (until, args.reason, args.details or args.reason, args.user_id))
                if cur.rowcount != 1 and not bool(target[1]): raise RuntimeError("Пользователь не найден или статус не изменился.")
                await conn.commit(); print("Пользователь заблокирован.")
            elif args.command == "unblock":
                await cur.execute("SELECT u.role,EXISTS(SELECT 1 FROM admins a WHERE a.tg_id=u.tg_id) FROM users u WHERE u.tg_id=%s LIMIT 1", (args.user_id,))
                target = await cur.fetchone()
                if not target: raise RuntimeError("Пользователь не найден.")
                if args.user_id in getattr(settings, "admin_ids", ()) or bool(target[1]) or str(target[0]).lower() == "admin": raise RuntimeError("Нельзя изменять блокировку защищённого профиля администратора.")
                await cur.execute("UPDATE users SET is_blocked=0,banned_until=NULL,ban_reason=NULL,ban_details=NULL WHERE tg_id=%s", (args.user_id,))
                await conn.commit(); print("Блокировка снята.")
            elif args.command == "extend-subscription":
                units = {"hours": ("HOUR", 8760), "days": ("DAY", 3650), "months": ("MONTH", 120)}
                if args.unit not in units or args.amount < 1 or args.amount > units[args.unit][1]:
                    raise RuntimeError("Проверь количество или единицу продления.")
                await cur.execute("SELECT u.role,EXISTS(SELECT 1 FROM admins a WHERE a.tg_id=u.tg_id) FROM users u WHERE u.tg_id=%s LIMIT 1", (args.user_id,))
                target = await cur.fetchone()
                if not target: raise RuntimeError("Пользователь не найден.")
                if args.user_id in getattr(settings, "admin_ids", ()) or bool(target[1]) or str(target[0]).lower() == "admin": raise RuntimeError("Нельзя продлевать подписку профиля администратора.")
                await cur.execute("SELECT id FROM subscription_keys WHERE used_by_tg_id=%s AND is_frozen=0 AND available_until>NOW() ORDER BY activated_at DESC,id DESC LIMIT 1 FOR UPDATE", (args.user_id,))
                key = await cur.fetchone()
                if not key: raise RuntimeError("У пользователя нет активной незамороженной подписки.")
                unit_sql = units[args.unit][0]
                await cur.execute(f"UPDATE subscription_keys SET available_until=DATE_ADD(GREATEST(available_until,NOW()), INTERVAL {int(args.amount)} {unit_sql}) WHERE id=%s AND used_by_tg_id=%s AND is_frozen=0 AND available_until>NOW()", (int(key[0]), args.user_id))
                if cur.rowcount != 1: raise RuntimeError("Срок подписки не изменился.")
                await cur.execute("DELETE FROM subscription_reminders WHERE subscription_key_id=%s", (int(key[0]),))
                await cur.execute("INSERT INTO admin_logs(admin_tg_id,action,details) VALUES(%s,%s,%s)", (args.actor_id, "admin_cli_extend_subscription", f"target={args.user_id} amount={args.amount} unit={args.unit}"))
                await conn.commit(); print(f"Подписка пользователя {args.user_id} продлена: +{args.amount} {args.unit}.")
            elif args.command == "deletion-queue":
                await cur.execute("SELECT id,tg_id,status,attempts,available_at,sent_at,last_error FROM admin_user_deletion_queue ORDER BY id DESC LIMIT %s", (max(1, min(args.limit, 500)),))
                print("ID | TG_ID | STATUS | ATTEMPTS | AVAILABLE_AT | SENT_AT | LAST_ERROR")
                for row in await cur.fetchall(): print(" | ".join(str(value if value is not None else "-") for value in row))
            elif args.command == "retry-deletion":
                await cur.execute("UPDATE admin_user_deletion_queue SET status='pending',attempts=0,available_at=NOW(),locked_at=NULL,last_error=NULL WHERE id=%s AND status='failed'", (args.queue_id,))
                if cur.rowcount != 1: raise RuntimeError("Не найдена завершившаяся ошибкой задача удаления.")
                await conn.commit(); print("Задача повторно поставлена в очередь.")
            elif args.command == "maintenance":
                values = {"maintenance_mode": "1" if args.enable else "0", "maintenance_title": args.title or "Технические работы", "maintenance_message": args.message or "Сервис временно недоступен. Попробуйте позже.", "maintenance_until": args.until or ""}
                for key, value in values.items():
                    await cur.execute("INSERT INTO app_settings(setting_key,setting_value) VALUES(%s,%s) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)", (key, value))
                await conn.commit(); print("Технические работы включены." if args.enable else "Технические работы завершены.")
            elif args.command == "keys":
                await cur.execute("SELECT id,key_prefix,role_on_activate,duration_days,usable,used_by_tg_id,created_at FROM subscription_keys ORDER BY id DESC LIMIT %s", (max(1,min(args.limit,500)),))
                print("ID | PREFIX | ROLE | DAYS | USABLE | USED_BY | CREATED")
                for r in await cur.fetchall(): print(" | ".join(str(x if x is not None else "-") for x in r))
            elif args.command == "disable-key":
                await cur.execute("UPDATE subscription_keys SET usable=0 WHERE id=%s AND used_by_tg_id IS NULL", (args.key_id,))
                if cur.rowcount != 1: raise RuntimeError("Свободный ключ не найден или уже использован.")
                await conn.commit(); print("Ключ отключён.")
            elif args.command == "change-user-key":
                # Match the WebApp assignment path: assign the key and synchronize the user role.
                await cur.execute("SELECT role FROM users WHERE tg_id=%s LIMIT 1", (args.user_id,))
                target_row = await cur.fetchone()
                if not target_row:
                    raise RuntimeError("Пользователь не найден.")
                await cur.execute("SELECT 1 FROM admins WHERE tg_id=%s LIMIT 1", (args.user_id,))
                in_admin_table = await cur.fetchone() is not None
                if args.user_id in getattr(settings, "admin_ids", ()) or in_admin_table or str(target_row[0]).lower() == "admin":
                    raise RuntimeError("Нельзя менять ключ защищённого профиля администратора.")
                try:
                    await conn.begin()
                    await cur.execute("SELECT id,duration_days,usable,used_by_tg_id,role_on_activate,key_prefix FROM subscription_keys WHERE id=%s FOR UPDATE", (args.key_id,))
                    key = await cur.fetchone()
                    if not key or not key[2] or key[3] is not None:
                        raise RuntimeError("Ключ недоступен, уже использован или не найден.")
                    activation_role = str(key[4] or "").strip().lower()
                    prefix = str(key[5] or "").upper().replace("_", "-")
                    prefix_tokens = {token for token in prefix.split("-") if token}
                    # A complete semantic role token in the visible prefix is the strongest signal.
                    if "SELLER" in prefix_tokens:
                        role_value = "seller"
                    elif "BUYER" in prefix_tokens:
                        role_value = "buyer"
                    elif "ADMIN" in prefix_tokens:
                        role_value = "admin"
                    else:
                        role_value = activation_role if activation_role in ("buyer", "seller", "admin") else "buyer"
                    await cur.execute("UPDATE subscription_keys SET available_until=NOW(),is_frozen=0,frozen_at=NULL,frozen_remaining_sec=NULL WHERE used_by_tg_id=%s AND available_until>NOW() AND is_frozen=0", (args.user_id,))
                    await cur.execute("UPDATE subscription_keys SET usable=0,used_by_tg_id=%s,activated_at=NOW(),available_until=DATE_ADD(NOW(),INTERVAL duration_days DAY),is_frozen=0,frozen_at=NULL,frozen_remaining_sec=NULL WHERE id=%s AND usable=1 AND used_by_tg_id IS NULL", (args.user_id, args.key_id))
                    if cur.rowcount != 1:
                        raise RuntimeError("Не удалось назначить ключ. Обнови список и повтори.")
                    await cur.execute("UPDATE users SET role=%s WHERE tg_id=%s", (role_value, args.user_id))
                    if role_value == "admin":
                        await cur.execute("INSERT IGNORE INTO admins(tg_id) VALUES(%s)", (args.user_id,))
                    elif args.user_id not in getattr(settings, "admin_ids", ()):
                        await cur.execute("DELETE FROM admins WHERE tg_id=%s", (args.user_id,))
                    await cur.execute("INSERT INTO admin_logs(admin_tg_id,action,details) VALUES(%s,%s,%s)", (args.actor_id, "admin_cli_change_user_key", f"target={args.user_id} key={args.key_id} role={role_value}"))
                    await conn.commit()
                except Exception:
                    await conn.rollback()
                    raise
                print(f"Ключ #{args.key_id} назначен пользователю {args.user_id}; роль: {role_value}.")
            elif args.command == "delete-user":
                if args.confirm != str(args.user_id):
                    raise RuntimeError("Удаление не подтверждено. Повтори команду с --confirm, равным ID пользователя.")
                if args.user_id in getattr(settings, "admin_ids", ()):
                    raise RuntimeError("Нельзя удалить ID из ADMIN_IDS.")
                # This infrastructure table is additive; ensure it exists before opening the deletion transaction.
                await cur.execute("""CREATE TABLE IF NOT EXISTS admin_user_deletion_queue (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tg_id BIGINT UNSIGNED NOT NULL,
                    requested_by_tg_id BIGINT UNSIGNED NULL, status VARCHAR(16) NOT NULL DEFAULT 'pending',
                    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0, available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    locked_at DATETIME NULL, sent_at DATETIME NULL, last_error VARCHAR(500) NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id),
                    KEY idx_admin_user_deletion_status (status, available_at, id), KEY idx_admin_user_deletion_tg (tg_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""")
                await conn.commit()
                try:
                    await conn.begin()
                    await cur.execute("SELECT role FROM users WHERE tg_id=%s FOR UPDATE", (args.user_id,))
                    target_row = await cur.fetchone()
                    if not target_row:
                        raise RuntimeError("Пользователь не найден.")
                    await cur.execute("SELECT 1 FROM admins WHERE tg_id=%s LIMIT 1", (args.user_id,))
                    if await cur.fetchone() or str(target_row[0]).lower() == "admin":
                        raise RuntimeError("Удаление администраторов запрещено.")
                    await cur.execute("INSERT INTO admin_user_deletion_queue(tg_id,requested_by_tg_id,status) VALUES(%s,%s,'pending')", (args.user_id, args.actor_id))
                    queue_id = cur.lastrowid
                    await cur.execute("DELETE f FROM user_favorites f LEFT JOIN products p ON p.id=f.product_id LEFT JOIN source_rows sr ON sr.id=p.source_row_id LEFT JOIN price_lists pl ON pl.id=sr.price_list_id WHERE f.user_tg_id=%s OR pl.owner_tg_id=%s", (args.user_id, args.user_id))
                    await cur.execute("DELETE FROM telegram_notification_queue WHERE chat_id=%s", (args.user_id,))
                    await cur.execute("DELETE FROM telegram_message_cleanup WHERE chat_id=%s", (args.user_id,))
                    await cur.execute("UPDATE subscription_keys SET owner_tg_id=NULL WHERE owner_tg_id=%s AND used_by_tg_id IS NOT NULL AND used_by_tg_id<>%s", (args.user_id, args.user_id))
                    await cur.execute("DELETE FROM subscription_keys WHERE used_by_tg_id=%s OR owner_tg_id=%s", (args.user_id, args.user_id))
                    await cur.execute("DELETE FROM price_lists WHERE owner_tg_id=%s", (args.user_id,))
                    await cur.execute("DELETE FROM users WHERE tg_id=%s", (args.user_id,))
                    if cur.rowcount != 1:
                        raise RuntimeError("Пользователь не был удалён.")
                    await cur.execute("INSERT INTO admin_logs(admin_tg_id,action,details) VALUES(%s,%s,%s)", (args.actor_id, "admin_cli_delete_user", f"target={args.user_id} queue_id={queue_id}"))
                    await conn.commit()
                except Exception:
                    await conn.rollback()
                    raise
                print(f"Пользователь {args.user_id} удалён из БД; очистка bot/data и уведомление поставлены в очередь #{queue_id}.")
    finally:
        conn.close()


def _clean_cache_directories(root: Path) -> int:
    """Remove generated Python/app cache folders beneath the bot project root."""
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
        raise RuntimeError("Для переноса установи зависимости проекта (PyMySQL из requirements.txt).") from exc
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


def _database_identity(cfg: dict[str, Any]) -> tuple[str, int, str, str]:
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


def _prompt_missing(cfg: dict[str, Any], label: str, *, target: bool = False) -> dict[str, Any]:
    result = dict(cfg)
    fields = [("host", "Хост", "localhost"), ("port", "Порт", "3306"), ("user", "Пользователь БД", ""),
              ("password", "Пароль БД", ""), ("database", "Имя базы данных", "")]
    for key, caption, default in fields:
        if result.get(key) in (None, ""):
            if key == "password":
                value = getpass.getpass(f"{label} — {caption}: ")
            else:
                value = input(f"{label} — {caption} [{default}]: ").strip() or default
            result[key] = int(value) if key == "port" else value
    return result


def _apply_overrides(cfg: dict[str, Any], args, prefix: str) -> dict[str, Any]:
    result = dict(cfg)
    for field in ("host", "port", "user", "password", "database"):
        value = getattr(args, f"{prefix}_{field}", None)
        if value is not None and value != "":
            result[field] = int(value) if field == "port" else value
    return result


def run_migration_args(args) -> int:
    source_cfg = config_from_env("source")
    target_cfg = config_from_env("target")
    source_php = getattr(args, "source_php_config", None)
    target_php = getattr(args, "target_php_config", None)
    # A common deployment has the old bot DB in MYSQL_* and the new WebApp DB
    # in PHP config/database.php. If a target PHP config is explicitly selected
    # and OLD/SOURCE variables are absent, use MYSQL_* as the source.
    if target_php and not source_cfg.get("host"):
        source_cfg = config_from_env("target")
    if source_php:
        source_cfg.update(load_php_db_config(source_php))
    if target_php:
        target_cfg.update(load_php_db_config(target_php))
    source_cfg = _apply_overrides(source_cfg, args, "source")
    target_cfg = _apply_overrides(target_cfg, args, "target")
    source_cfg = _prompt_missing(source_cfg, "Старая БД")
    target_cfg = _prompt_missing(target_cfg, "Новая БД", target=True)
    if _database_identity(source_cfg) == _database_identity(target_cfg):
        raise RuntimeError("Источник и целевая БД совпадают. Проверь настройки подключения.")

    if args.apply:
        expected = str(getattr(args, "confirm_target_db", "") or "")
        if expected != str(target_cfg["database"]):
            raise RuntimeError("Для изменения данных укажи --confirm-target-db ТОЧНОЕ_ИМЯ_ЦЕЛЕВОЙ_БД. Без этого миграция не выполняется.")
        print("ВНИМАНИЕ: миграция заменит строки во всех одноимённых таблицах целевой БД. Таблицы только в целевой БД останутся нетронутыми.")
    result = migrate_databases(
        source_cfg, target_cfg, apply=bool(args.apply), batch_size=int(args.batch_size), progress=print,
    )
    if not args.apply:
        print("\nРежим предварительного просмотра: база назначения не изменена.")
        print("Для переноса запусти с --apply --confirm-target-db", target_cfg["database"])
    return 0




def _build_parser():
    parser = argparse.ArgumentParser(description="Basalt Perfume command-line admin, database migration and activation-key generator")
    parser.add_argument("--db-host", default=None, help="MYSQL_HOST override")
    parser.add_argument("--db-port", type=int, default=None, help="MYSQL_PORT override")
    parser.add_argument("--db-user", default=None, help="MYSQL_USER override")
    parser.add_argument("--db-password", default=None, help="MYSQL_PASSWORD override; prefer .env")
    parser.add_argument("--db-name", default=None, help="MYSQL_DATABASE override")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("clean-cache", help="Удалить папки __cache__ и __pycache__ во всём проекте бота")
    sub.add_parser("stats", help="Сводка по таблицам и режиму техработ")
    users = sub.add_parser("users", help="Список пользователей")
    users.add_argument("--role", choices=("admin","seller","buyer","none"))
    users.add_argument("--limit", type=int, default=50)
    role = sub.add_parser("set-role", help="Изменить роль пользователя")
    role.add_argument("user_id", type=int); role.add_argument("role", choices=("admin","seller","buyer","none"))
    block = sub.add_parser("block", help="Заблокировать пользователя")
    block.add_argument("user_id", type=int); block.add_argument("--reason", required=True); block.add_argument("--details", default="")
    block.add_argument("--until", default=None, help="YYYY-MM-DD HH:MM:SS"); block.add_argument("--permanent", action="store_true")
    unblock = sub.add_parser("unblock", help="Снять блокировку")
    unblock.add_argument("user_id", type=int)
    extend = sub.add_parser("extend-subscription", help="Продлить активную подписку пользователя")
    extend.add_argument("user_id", type=int); extend.add_argument("amount", type=int); extend.add_argument("unit", choices=("hours", "days", "months"))
    extend.add_argument("--actor-id", type=int, default=None, help="ID администратора для аудита")
    del_queue = sub.add_parser("deletion-queue", help="Показать последние задачи удаления пользователей")
    del_queue.add_argument("--limit", type=int, default=50)
    retry_del = sub.add_parser("retry-deletion", help="Повторить завершившуюся ошибкой задачу удаления")
    retry_del.add_argument("queue_id", type=int)
    maintenance = sub.add_parser("maintenance", help="Включить/выключить техработы")
    mode = maintenance.add_mutually_exclusive_group(required=True); mode.add_argument("--enable", action="store_true"); mode.add_argument("--disable", action="store_true")
    maintenance.add_argument("--title", default="Технические работы"); maintenance.add_argument("--message", default="Сервис временно недоступен. Попробуйте позже."); maintenance.add_argument("--until", default="")
    keys = sub.add_parser("keys", help="Список последних ключей")
    keys.add_argument("--limit", type=int, default=50)
    disable = sub.add_parser("disable-key", help="Отключить свободный ключ")
    disable.add_argument("key_id", type=int)
    change_key = sub.add_parser("change-user-key", help="Назначить пользователю свободный ключ и синхронизировать роль")
    change_key.add_argument("user_id", type=int); change_key.add_argument("key_id", type=int)
    change_key.add_argument("--actor-id", type=int, default=None, help="ID администратора для аудита")
    delete_user = sub.add_parser("delete-user", help="Полностью удалить пользователя и поставить очистку bot/data в очередь")
    delete_user.add_argument("user_id", type=int); delete_user.add_argument("--confirm", required=True, help="Повтори ID пользователя для подтверждения")
    delete_user.add_argument("--actor-id", type=int, default=None, help="ID администратора для аудита")
    gen = sub.add_parser("generate-keys", help="Локально создать 6 ключей + SQL/TXT для phpMyAdmin")
    gen.add_argument("--secret", default=os.getenv("KEY_ENCRYPTION_SECRET", "")); gen.add_argument("--days", type=int, default=30); gen.add_argument("--out-dir", default=".")
    migration = sub.add_parser("migrate-db", help="Показать план или перенести данные из старой MySQL БД в новую")
    for prefix, label in (("source", "старой БД"), ("target", "новой БД")):
        migration.add_argument(f"--{prefix}-host", default=None, help=f"Хост {label}")
        migration.add_argument(f"--{prefix}-port", type=int, default=None, help=f"Порт {label}")
        migration.add_argument(f"--{prefix}-user", default=None, help=f"Пользователь {label}")
        migration.add_argument(f"--{prefix}-password", default=None, help=f"Пароль {label}; лучше хранить в .env")
        migration.add_argument(f"--{prefix}-database", default=None, help=f"Имя {label}")
    migration.add_argument("--source-php-config", default=None, help="PHP-файл с параметрами исходной БД")
    migration.add_argument("--target-php-config", default=None, help="PHP-файл с параметрами целевой БД")
    migration.add_argument("--apply", action="store_true", help="Выполнить перенос, иначе только проверка")
    migration.add_argument("--confirm-target-db", default="", help="Точное имя целевой БД (обязательно с --apply)")
    migration.add_argument("--batch-size", type=int, default=500, help="Размер пакета строк (1–10000)")
    return parser


def main():
    parser = _build_parser()
    if len(sys.argv) == 1:
        parser.print_help()
        return 0
    args = parser.parse_args()
    try:
        if args.command == "clean-cache":
            count = _clean_cache_directories(Path(__file__).resolve().parent)
            print(f"Удалено папок кэша: {count}")
            return 0
        if args.command == "generate-keys":
            secret = str(args.secret or "").strip()
            if len(secret) >= 2 and ((secret[0] == "'" and secret[-1] == "'") or (secret[0] == '"' and secret[-1] == '"')): secret = secret[1:-1]
            if not secret: raise RuntimeError("Передай --secret или задай KEY_ENCRYPTION_SECRET в окружении.")
            if not (1 <= args.days <= 3650): raise RuntimeError("--days должен быть от 1 до 3650.")
            _self_test(); records = generate_records(secret, args.days)
            out = Path(args.out_dir).expanduser().resolve(); out.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            sql_path = out / f"role_activation_keys_{stamp}.sql"; txt_path = out / f"role_activation_keys_{stamp}.txt"
            sql_path.write_text(build_sql(records), encoding="utf-8"); txt_path.write_text(build_plaintext(records), encoding="utf-8")
            print(f"SQL: {sql_path}\nКлючи: {txt_path}\nИмпортируй SQL через phpMyAdmin. TXT храни безопасно.")
            return 0
        if args.command == "migrate-db":
            return run_migration_args(args)
        asyncio.run(_db_command(args))
        return 0
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        print("ERROR:", exc, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
