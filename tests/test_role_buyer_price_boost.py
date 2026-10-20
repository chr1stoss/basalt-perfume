from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def test_role_migration_is_additive_and_converts_old_users_to_sellers():
    sql = (ROOT / 'bot/database/migrations/08_roles_price_multiplier_key_format.sql').read_text(encoding='utf-8')
    assert "UPDATE users SET role='seller' WHERE role='user'" in sql
    assert "ENUM('admin','seller','buyer','none')" in sql
    assert 'ADD COLUMN price_multiplier DECIMAL(7,2) NOT NULL DEFAULT 1.00' in sql
    assert 'ADD COLUMN key_ciphertext TEXT NULL' in sql
    executable_sql = re.sub(r'--[^\n]*', '', sql)
    assert 'DROP TABLE' not in executable_sql.upper()


def test_buyer_api_has_global_effective_prices_without_source_metadata():
    api = (ROOT / 'htdocs/api.php').read_text(encoding='utf-8')
    assert "if ($auth['role'] === 'buyer')" in api
    assert re.search(r'\(p\.price_usd\s*\*\s*p\.price_multiplier\) AS price_usd', api)
    assert '0 AS needs_review,NULL AS defects_json,NULL AS file_id,NULL AS filename' in api
    assert "if ($auth['role']==='buyer') $filters['file_id']=''" in api or "if ($auth['role'] === 'buyer')" in api
    assert "if ($action === 'set_price_multiplier')" in api
    assert "'buyer'" in api and "'seller'" in api


def test_buyer_webapp_has_search_only_and_seller_price_boost_controls():
    js = (ROOT / 'htdocs/assets/app.js').read_text(encoding='utf-8')
    assert "currentRole==='buyer'?'search':'prices'" in js
    assert 'function openPriceBoostModal()' in js
    assert 'data-boost-mode="analog"' in js and 'data-boost-mode="keyboard"' in js
    assert "api('set_price_multiplier'" in js
    assert "currentRole!=='buyer'&&p.needs_review" in js
    assert "currentRole==='buyer'?p.price_usd" in js


def test_admin_user_modal_and_schedule_picker_are_bound_to_api():
    js = (ROOT / 'htdocs/assets/app.js').read_text(encoding='utf-8')
    api = (ROOT / 'htdocs/api.php').read_text(encoding='utf-8')
    admin_actions = (ROOT / 'htdocs/actions/admin_users.php').read_text(encoding='utf-8')
    assert 'function openAdminUserModal(userId)' in js
    assert "api('admin_user_details',{user_id:userId})" in js
    assert "api('admin_update_user',payload)" in js
    assert 'data-ban-mode="calendar"' in js and 'data-ban-mode="keyboard"' in js
    assert "require __DIR__ . '/actions/admin_users.php'" in api
    assert "if ($action === 'admin_update_user')" in admin_actions
    assert "if ($action === 'admin_user_details')" in admin_actions


def test_fixed_russian_label_full_name_marquee_and_removed_apply_telegram_button():
    js = (ROOT / 'htdocs/assets/app.js').read_text(encoding='utf-8')
    assert "return html.split('__BP_FIXED_RUSSIAN__').join('Русский')" in js
    assert 'function initProfileNameMarquee()' in js
    assert 'last_name' in js and 'profile-name-marquee' in js
    settings = js[js.index('function renderSettings()'):js.index('function customDropdown(')]
    assert 'Применить язык в Telegram' not in settings


def test_key_format_and_secret_configuration():
    api = (ROOT / 'htdocs/api.php').read_text(encoding='utf-8')
    env = (ROOT / '.env.example').read_text(encoding='utf-8')
    config = (ROOT / 'htdocs/config/database.example.php').read_text(encoding='utf-8')
    assert re.search(r"\$raw='BP-'\.random_subscription_key_group\(\).*random_subscription_key_group", api)
    assert 'KEY_ENCRYPTION_SECRET=' in env
    assert "'key_encryption_secret' => getenv('KEY_ENCRYPTION_SECRET')" in config
    assert 'key_ciphertext' in api and 'hash_equals' in api
    # The admin API should not return one-way key hashes or encrypted ciphertext to the browser.
    assert "unset($keyRow['key_ciphertext'], $keyRow['key_hash']);" in api


def test_brand_dictionary_is_saved_during_import_and_has_backfill_command():
    parser = (ROOT / 'bot/services/parser/price_list.py').read_text(encoding='utf-8')
    seed = ROOT / 'bot/database/seed_brands.py'
    assert 'INSERT INTO brands(name,normalized_name,sources_json,aliases_json)' in parser
    assert 'INSERT INTO brand_aliases(alias,normalized_alias,canonical_brand,brand_id,source,confidence,ambiguous)' in parser
    assert seed.exists()
    assert 'UPDATE products SET brand_id=%s WHERE id=%s' in seed.read_text(encoding='utf-8')
