#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Локальный генератор ключей BUYER/SELLER/ADMIN для Basalt Perfume.

Запускается на компьютере пользователя (двойным щелчком), не на сервере.
Не требует сторонних Python-пакетов. Создаёт SQL для импорта в phpMyAdmin
и отдельный TXT с открытыми ключами. Шифрование совместимо с PHP seed-скриптом.
"""

import base64
import hashlib
import hmac
import os
import secrets
import tkinter as tk
from datetime import datetime
from tkinter import filedialog, messagebox, ttk

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


def run_gui():
    root = tk.Tk()
    root.title("Генератор ключей Basalt Perfume")
    root.geometry("640x390")
    root.minsize(600, 350)

    frame = ttk.Frame(root, padding=18)
    frame.pack(fill="both", expand=True)
    ttk.Label(frame, text="Создание 6 ключей с назначением роли", font=("Segoe UI", 13, "bold")).pack(anchor="w")
    ttk.Label(frame, text="Файлы будут подготовлены локально: SQL для phpMyAdmin и TXT с открытыми ключами.", wraplength=590).pack(anchor="w", pady=(5, 16))

    secret_var = tk.StringVar()
    days_var = tk.StringVar(value="30")
    show_var = tk.BooleanVar(value=False)

    ttk.Label(frame, text="KEY_ENCRYPTION_SECRET из .env / config/database.php:").pack(anchor="w")
    secret_entry = ttk.Entry(frame, textvariable=secret_var, show="•", width=72)
    secret_entry.pack(fill="x", pady=(4, 5))

    def toggle_secret():
        secret_entry.configure(show="" if show_var.get() else "•")
    ttk.Checkbutton(frame, text="Показать секрет", variable=show_var, command=toggle_secret).pack(anchor="w", pady=(0, 12))

    row = ttk.Frame(frame)
    row.pack(fill="x", pady=(0, 12))
    ttk.Label(row, text="Длительность подписки (дней):").pack(side="left")
    ttk.Entry(row, textvariable=days_var, width=10).pack(side="left", padx=(8, 0))

    ttk.Label(frame, text="Важно: сначала проверь, что секрет совпадает с тем, которым WebApp шифрует subscription_keys.key_ciphertext. Не используй значение из самого key_ciphertext.", wraplength=590).pack(anchor="w", pady=(0, 14))

    def create_files():
        secret = secret_var.get().strip()
        if len(secret) >= 2 and ((secret[0] == "'" and secret[-1] == "'") or (secret[0] == '"' and secret[-1] == '"')):
            secret = secret[1:-1]
        if not secret:
            messagebox.showerror("Нет секрета", "Введи значение KEY_ENCRYPTION_SECRET из конфигурации сервера.", parent=root)
            return
        try:
            days = int(days_var.get().strip())
        except ValueError:
            messagebox.showerror("Неверный срок", "Укажи целое число дней от 1 до 3650.", parent=root)
            return
        if not (1 <= days <= 3650):
            messagebox.showerror("Неверный срок", "Укажи целое число дней от 1 до 3650.", parent=root)
            return
        directory = filedialog.askdirectory(title="Куда сохранить файлы с ключами", mustexist=True, parent=root)
        if not directory:
            return
        try:
            _self_test()
            records = generate_records(secret, days)
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            sql_path = os.path.join(directory, "role_activation_keys_{}.sql".format(stamp))
            txt_path = os.path.join(directory, "role_activation_keys_{}.txt".format(stamp))
            with open(sql_path, "w", encoding="utf-8", newline="\n") as f:
                f.write(build_sql(records))
            with open(txt_path, "w", encoding="utf-8", newline="\n") as f:
                f.write(build_plaintext(records))
            messagebox.showinfo(
                "Файлы созданы",
                "Создано 6 ключей: по 2 для BUYER, SELLER и ADMIN.\n\n"
                "1. Импортируй SQL через phpMyAdmin → Import.\n"
                "2. Сохрани TXT в безопасном месте.\n\n"
                "SQL: {}\nTXT: {}\n\n"
                "Не загружай TXT в публичное место. Админские ключи выдавай только доверенным людям.".format(sql_path, txt_path),
                parent=root,
            )
        except Exception as exc:
            messagebox.showerror("Ошибка генерации", str(exc), parent=root)

    ttk.Button(frame, text="Создать SQL и список ключей", command=create_files).pack(anchor="w", pady=(0, 10))
    ttk.Label(frame, text="Скрипт не подключается к серверу и не отправляет секрет в интернет. Импорт SQL выполняется через панель phpMyAdmin.", wraplength=590).pack(anchor="w")
    root.mainloop()


if __name__ == "__main__":
    try:
        _self_test()
    except Exception as exc:
        try:
            messagebox.showerror("Ошибка самопроверки", str(exc))
        except Exception:
            print(str(exc))
        raise SystemExit(1)
    run_gui()
