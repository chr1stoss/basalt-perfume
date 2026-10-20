import re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DUMPS=(ROOT/'bot/database/dumps/14_full_install_empty_brands.sql',ROOT/'bot/database/dumps/15_full_install_with_brands.sql')
REQUIRED={
 'users':{'tg_id','username','first_name','last_name','photo_url','is_blocked','role','price_multiplier','ban_details'},
 'subscription_keys':{'id','key_hash','key_prefix','key_ciphertext','owner_tg_id','used_by_tg_id','usable','duration_days','role_on_activate','activated_at','available_until','is_frozen'},
 'user_settings':{'tg_id','language','theme','appearance','notify_updates','notify_processed_files','notify_subscription'},
 'price_lists':{'id','filename','owner_tg_id','filepath','size_bytes','status','supplier_name','imported_at','parser_version'},
 'source_rows':{'id','price_list_id','source_file','source_sheet','source_row_number','row_status','title_candidate','raw_price','column_roles_json','raw_cells_json','product_id','notes'},
 'products':{'id','source_row_id','brand','name','type','category','defects_json','volume_ml','volume_text','price_usd','price_multiplier','price_raw','currency','gender','is_tester','is_sample','is_set','set_component_count','extra_info_json','raw_title','raw_cells_json','source_file','source_sheet','source_row_number','parse_confidence','needs_review','review_reasons_json'},
 'product_components':{'id','parent_product_id','sequence_no','brand','name','type','category','quantity','volume_ml','volume_text','gender','raw_component','needs_review','review_reasons_json'},
 'app_notifications':{'id','tg_id','kind','title','body','is_read','created_at'},
}

def read_schema_columns(sql_text):
    tables={}
    create_re=re.compile(r'CREATE\s+TABLE\s+`?(\w+)`?\s*\((.*?)\)\s*ENGINE\s*=',re.I|re.S)
    for match in create_re.finditer(sql_text):
        table,body=match.groups(); cols=set()
        for line in body.splitlines():
            line=line.strip().rstrip(',')
            m=re.match(r'`?([A-Za-z_][A-Za-z0-9_]*)`?\s+',line)
            if m and m.group(1).upper() not in {'PRIMARY','UNIQUE','KEY','INDEX','CONSTRAINT','FOREIGN','CHECK'}: cols.add(m.group(1))
        tables[table]=cols
    return tables

def test_all_required_columns_exist_in_every_full_schema_dump():
    for dump in DUMPS:
        tables=read_schema_columns(dump.read_text(encoding='utf-8'))
        for table,columns in REQUIRED.items():
            assert table in tables, f'{dump.name}: missing table {table}'
            assert columns <= tables[table], f'{dump.name}: {table} missing {columns-tables[table]}'

def test_language_is_in_initial_schema_and_upgrade_is_additive():
    for dump in DUMPS:
        sql=dump.read_text(encoding='utf-8')
        assert re.search(r"language\s+ENUM\('ru','en','kz'\)\s+NOT NULL DEFAULT 'ru'",sql,re.I)
    for patch_name in ('03_upgrade_existing_language.sql','03_upgrade_existing_webapp.sql'):
        patch=(ROOT/'bot/database/migrations'/patch_name).read_text(encoding='utf-8')
        assert 'information_schema.COLUMNS' in patch
        assert 'ADD COLUMN language' in patch
        assert 'DROP TABLE' not in patch.upper()

def test_foreign_key_column_types_match():
    sql=DUMPS[0].read_text(encoding='utf-8'); tables={}
    create_re=re.compile(r'CREATE\s+TABLE\s+`?(\w+)`?\s*\((.*?)\)\s*ENGINE\s*=',re.I|re.S)
    for table,body in create_re.findall(sql):
        cols={}
        for line in body.splitlines():
            m=re.match(r'\s*`?([A-Za-z_][A-Za-z0-9_]*)`?\s+([A-Za-z]+(?:\(\d+\))?(?:\s+UNSIGNED)?)',line,re.I)
            if m and m.group(1).upper() not in {'PRIMARY','UNIQUE','KEY','INDEX','CONSTRAINT','FOREIGN','CHECK'}: cols[m.group(1)]=re.sub(r'\s+',' ',m.group(2).upper())
        tables[table]=(cols,body)
    checked=0
    for table,(cols,body) in tables.items():
        for line in body.splitlines():
            m=re.search(r'FOREIGN KEY\s*\(\s*`?(\w+)`?\s*\)\s*REFERENCES\s*`?(\w+)`?\s*\(\s*`?(\w+)`?\s*\)',line,re.I)
            if not m: continue
            local,ref_table,ref_col=m.groups(); assert local in cols and ref_table in tables and ref_col in tables[ref_table][0]
            assert cols[local]==tables[ref_table][0][ref_col],f'{table}.{local} {cols[local]} != {ref_table}.{ref_col} {tables[ref_table][0][ref_col]}'
            checked+=1
    assert checked>=8

def test_api_contains_extended_filters_and_safe_photo_column_reference():
    api=(ROOT/'htdocs/api.php').read_text(encoding='utf-8')
    for field in ('filter_options','volume','tester','is_set','file_id','gender','category','needs_review','min_price','max_price'):
        assert field in api
    assert "photo_url=CASE WHEN ? LIKE '/uploads/avatars/%'" in api
    assert 'cache_telegram_avatar_from_bot_api' in api and "hash('sha256'" in api


def test_user_upserts_use_mysql_mariadb_compatible_duplicate_key_syntax():
    api=(ROOT/'htdocs/api.php').read_text(encoding='utf-8')
    users=(ROOT/'bot/database/queries/users.py').read_text(encoding='utf-8')
    for source in (api, users):
        assert ' AS incoming ON DUPLICATE KEY UPDATE' not in source
        assert 'ON DUPLICATE KEY UPDATE' in source
        assert 'VALUES(username)' not in source
    assert 'username=?,first_name=?,last_name=?' in api
    assert 'username=%s,first_name=%s,last_name=%s' in users

def test_bot_validates_existing_schema_without_creating_tables():
    connection=(ROOT/'bot/database/connection.py').read_text(encoding='utf-8')
    assert 'information_schema.COLUMNS' in connection
    assert 'CREATE TABLE' not in connection.upper()
    assert 'не меняет БД автоматически' in connection

def test_parser_protects_legacy_xls_and_has_repair_fallbacks():
    parser=(ROOT/'bot/services/sort/parser_engine.py').read_text(encoding='utf-8')
    assert '_read_xls_via_libreoffice' in parser
    assert '_read_xls_via_xlrd' in parser
    assert '_read_xls_via_excel_com' in parser
    assert '271059712' in parser

def test_webapp_filter_sheet_uses_svg_and_has_all_filter_dimensions():
    js=(ROOT/'htdocs/assets/app.js').read_text(encoding='utf-8')
    css=(ROOT/'htdocs/assets/app.css').read_text(encoding='utf-8')
    for field in ('brand','volume','type','file_id','gender','category','tester','is_set','needs_review','min_price','max_price'):
        assert field in js, f'missing filter field {field}'
    icons=(ROOT/'htdocs/assets/js/components/icons.js').read_text(encoding='utf-8')
    assert 'function iconSvg' in js and '<svg class="svg-icon"' in icons
    assert '.filter-modal' in css and '@media(min-width:1080px)' in css

def test_uploads_are_background_tasks_and_user_messages_are_deleted():
    router="\n".join(p.read_text(encoding="utf-8") for p in (ROOT / "bot/handlers").rglob("*.py"))
    assert 'asyncio.create_task(_flush_batch_later' in router
    assert 'asyncio.gather(' in router and 'process_price_file(bot, tg_id, item["filename"]' in router
    assert 'BATCH_COALESCE_SECONDS = 4.5' in router
    assert 'MEDIA_GROUP_COALESCE_SECONDS = 7.5' in router
    assert '"media_group_id": message.media_group_id' in router
    assert 'await delete_user_message(message)' in router
    assert 'await bot.download_file' in router

def test_notifications_are_photo_captions_with_read_button():
    service=(ROOT/'bot/services/notifications/telegram.py').read_text(encoding='utf-8')
    router="\n".join(p.read_text(encoding="utf-8") for p in (ROOT / "bot/handlers").rglob("*.py"))
    assert 'send_photo' in service and 'callback_data="read:" + str(notification_id)' in service
    assert 'F.data.startswith("read:")' in router


def test_parser_uses_actual_foreign_key_ids_and_retries_deadlocks():
    parser=(ROOT/'bot/services/parser/price_list.py').read_text(encoding='utf-8')
    assert 'SELECT id,source_file,source_sheet,source_row_number FROM source_rows' in parser
    assert 'SELECT id,source_row_id FROM products WHERE source_row_id IN' in parser
    assert 'errno not in (1213, 1205)' in parser
    assert 'async with _db_write_lock' in parser


def test_webapp_notifications_are_single_open_accordion_and_preview_is_live():
    js=(ROOT/'htdocs/assets/app.js').read_text(encoding='utf-8')
    css=(ROOT/'htdocs/assets/css/visual-system.css').read_text(encoding='utf-8')
    assert 'notification-accordion' in js
    assert "api('mark_read',{id:Number(id)})" in js
    assert 'data-read' not in js
    assert 'customDropdown' in js and 'previewBadge' in js
    assert '.notification-accordion.open .notification-details' in css
    assert '.custom-select.open .custom-select-menu' in css


def test_bot_notification_expiry_and_inline_edits_are_supported():
    service=(ROOT/'bot/services/notifications/telegram.py').read_text(encoding='utf-8')
    router="\n".join(p.read_text(encoding="utf-8") for p in (ROOT / "bot/handlers").rglob("*.py"))
    assert 'INTERVAL 1 MINUTE' in service
    assert 'cleanup_expired_telegram_messages' in service
    assert 'UPDATE app_notifications SET is_read=1' in router
    assert 'await bot.edit_message_media(' in router
    assert 'replace the whole message' in router
    assert 'await photo_message(bot,call.from_user.id' not in router



def test_cleanup_queue_is_in_schema_and_shared_by_php_and_bot():
    schema=(ROOT/'bot/database/legacy/01_schema.sql').read_text(encoding='utf-8')
    migration=(ROOT/'bot/database/migrations/04_telegram_notification_cleanup.sql').read_text(encoding='utf-8')
    api=(ROOT/'htdocs/api.php').read_text(encoding='utf-8')
    cleanup=(ROOT/'bot/services/notifications/telegram.py').read_text(encoding='utf-8')
    assert 'telegram_message_cleanup' in schema and 'CREATE TABLE IF NOT EXISTS' in migration
    assert 'schedule_telegram_notification_cleanup' in api
    assert 'cleanup_expired_telegram_messages' in cleanup
    assert 'telegram_message_cleanup' in cleanup


def test_basalt_bugfixes_are_wired_through_ui_api_and_bot():
    root = ROOT
    router = "\n".join(p.read_text(encoding="utf-8") for p in (root / "bot/handlers").rglob("*.py"))
    app = (root / 'htdocs/assets/app.js').read_text(encoding='utf-8')
    effects = (root / 'htdocs/assets/js/effects.js').read_text(encoding='utf-8')
    css = (root / 'htdocs/assets/css/visual-system.css').read_text(encoding='utf-8')
    api = (root / 'htdocs/api.php').read_text(encoding='utf-8')

    assert 'Command("subscribe")' in router and 'payload.lower() == "subscribe"' in router
    assert "await bot.delete_message(chat_id=chat_id, message_id=message_id)" in router
    assert 'MEDIA_GROUP_COALESCE_SECONDS = 7.5' in router
    assert 'media_group_id' in router and 'batch_received_body' in (root / 'bot/core/i18n.py').read_text(encoding='utf-8')
    assert "?start=" in app and 'developer_username' in app and 'faq-list-card' in app
    assert 'avatar-image' in app and 'custom-select filter-custom-select' in app
    assert 'if (!initialized)' in effects and 'seedPoints();' in effects
    assert 'body.light .card' in css and '.dot-matrix-loader' in css and 'position: sticky' in css
    assert "AS db_is_admin" in api and "$userRow['role']" in api


def test_full_demo_dump_contains_the_latest_fixes_and_one_key_per_role():
    sql=(ROOT/'bot/database/seeds/02_full_demo.sql').read_text(encoding='utf-8')
    assert 'users' in sql and 'photo_url VARCHAR(512)' in sql
    assert "language ENUM('ru','en','kz') NOT NULL DEFAULT 'ru'" in sql
    assert 'CREATE TABLE IF NOT EXISTS `telegram_message_cleanup`' in sql
    assert "'DEMO-BUYER-30D-A1B2'" in sql
    assert "'DEMO-SELLER-30D-C3D4'" in sql
    assert "'DEMO-ADMIN-30D-E5F6'" in sql
    assert "'buyer')" in sql and "'seller')" in sql and "'admin')" in sql
    assert 'role_on_activate' in sql
    assert 'key_ciphertext TEXT NULL' in sql
    assert 'SHA2(' in sql and 'DROP TABLE IF EXISTS' in sql

def test_development_tooling_files_are_present_and_configured():
    root=ROOT
    for relative in ('.dockerignore','.pre-commit-config.yaml','Dockerfile','Makefile','docker-compose.yml','pytest.ini','.github/workflows/ci.yml'):
        assert (root/relative).is_file(), f'missing {relative}'
    compose=(root/'docker-compose.yml').read_text(encoding='utf-8')
    assert '02_full_demo.sql' in compose and 'basalt_db_data' in compose
    workflow=(root/'.github/workflows/ci.yml').read_text(encoding='utf-8')
    assert 'python -m pytest' in workflow and 'node --check' in workflow

def test_filter_ui_has_animated_segment_indicators_and_external_gate():
    js=(ROOT/'htdocs/assets/app.js').read_text(encoding='utf-8')
    css=(ROOT/'htdocs/assets/css/visual-system.css').read_text(encoding='utf-8')
    index=(ROOT/'htdocs/index.php').read_text(encoding='utf-8')
    assert 'data-active-tab' in js and 'data-active-mode' in js
    assert 'data-landing-copy' in js and 'external-telegram-card' in js
    assert 'currentColor' in js and '.price-range-values span.is-active' in css
    assert 'BASALT_BOT_USERNAME' in index
    assert "?text=" in js and 'Basalt Perfume' in js
    assert "closest('a.telegram-link, a[data-user-link]')" not in js and 'Telegram buttons remain ordinary anchor links' in js and '?text=' in js and 'target=\"_blank\"' in js

def test_keyboard_interrupt_is_handled_without_uncaught_traceback():
    source=(ROOT/'main.py').read_text(encoding='utf-8')
    assert 'except KeyboardInterrupt:' in source


def test_latest_ui_requests_use_normal_telegram_links_localized_errors_and_key_controls():
    root=Path(__file__).resolve().parents[1]
    app=(root/'htdocs/assets/app.js').read_text(encoding='utf-8')
    api=(root/'htdocs/api.php').read_text(encoding='utf-8')
    icons=(root/'htdocs/assets/js/components/icons.js').read_text(encoding='utf-8')
    css=(root/'htdocs/assets/css/visual-system.css').read_text(encoding='utf-8')
    assert 'title_and_message_required' in app and 'Please fill in both fields' in app
    assert "{value:'name_desc', label:'Я–А'}" in app and "elseif ($sort === 'name_desc') $sortSql='p.name DESC'" in api
    assert 'data-key-reveal' in app and 'data-key-copy' in app and 'key_ciphertext' in api
    assert "?text='+encodeURIComponent(draft)" in app
    assert "'eye-off':" in icons and "copy:" in icons and "code:" in icons
    assert '.admin-key-value.is-blurred' in css and '.keys-output-input' in css
    assert 'window.scrollTo' in app and 'Доступ до:' in app


def test_navigation_and_telegram_links_use_native_anchors_and_cache_busted():
    root=Path(__file__).resolve().parents[1]
    app=(root/'htdocs/assets/app.js').read_text(encoding='utf-8')
    index=(root/'htdocs/index.php').read_text(encoding='utf-8')
    header=(root/'htdocs/components/header.php').read_text(encoding='utf-8')
    css=(root/'htdocs/assets/css/visual-system.css').read_text(encoding='utf-8')
    assert 'function resetPageScroll()' in app and 'if(activeScreen===screen)resetPageScroll()' in app
    assert "closest('a.telegram-link, a[data-user-link]')" not in app and 'Telegram buttons remain ordinary anchor links' in app
    assert "?text='+encodeURIComponent(draft)" in app
    assert __import__('re').search(r'src="assets/app.js\?v=\d+"', index) and __import__('re').search(r'visual-system.css\?v=\d+"', index)
    assert 'body .subscription-card:after' in css and 'bottom: -78px !important' in css


def test_avatar_cache_key_reveal_and_separate_placeholders():
    root=Path(__file__).resolve().parents[1]
    api=(root/'htdocs/api.php').read_text(encoding='utf-8')
    app=(root/'htdocs/assets/app.js').read_text(encoding='utf-8')
    css=(root/'htdocs/assets/css/visual-system.css').read_text(encoding='utf-8')
    index=(root/'htdocs/index.php').read_text(encoding='utf-8')
    header=(root/'htdocs/components/header.php').read_text(encoding='utf-8')
    assert 'cache_telegram_avatar_from_url' in api and 'cache_telegram_avatar_from_bot_api' in api
    assert "'/uploads/avatars/' . $filename" in api and 'reveal_subscription_key' in api
    assert "assets/img/avatar-placeholder.webp" in app
    assert 'avatar-shell.is-loaded .avatar-placeholder' in css
    assert 'assets/img/logo.svg?v=1' in header
    assert 'data-key-reveal' in app and 'data-key-copy' in app and 'loadAdminKey' in app
    assert 'var canReveal = !!(k.can_reveal || k.full_key);' in app
    assert '<rect x=\"2.5\" y=\"12\" width=\"19.5\"' in app

def test_both_demo_seeds_define_exactly_one_activation_key_per_role():
    for filename in ('01_demo.sql', '02_full_demo.sql'):
        sql = (ROOT / 'bot/database/seeds' / filename).read_text(encoding='utf-8')
        assert sql.count("SHA2('DEMO-BUYER-30D-A1B2', 256)") == 1
        assert sql.count("SHA2('DEMO-SELLER-30D-C3D4', 256)") == 1
        assert sql.count("SHA2('DEMO-ADMIN-30D-E5F6', 256)") == 1
        assert "'DEMO-BUYER', 1, 30, 'buyer'" in sql
        assert "'DEMO-SELLER', 1, 30, 'seller'" in sql
        assert "'DEMO-ADMIN', 1, 30, 'admin'" in sql
