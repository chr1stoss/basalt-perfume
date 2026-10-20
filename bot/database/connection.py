import aiomysql
import logging
from bot.config import settings

_pool = None
logger = logging.getLogger(__name__)
REQUIRED_COLUMNS = {
    'users': {'tg_id','username','first_name','last_name','role','price_multiplier','photo_url','is_blocked','ban_details'},
    'subscription_keys': {'id','key_hash','key_prefix','key_ciphertext','owner_tg_id','used_by_tg_id','usable','duration_days','activated_at','available_until','is_frozen'},
    'user_settings': {'tg_id','language','theme','appearance','notify_updates','notify_processed_files','notify_subscription','menu_chat_id','menu_message_id'},
    'price_lists': {'id','filename','owner_tg_id','filepath','size_bytes','status','supplier_name','imported_at','parser_version'},
    'source_rows': {'id','price_list_id','source_file','source_sheet','source_row_number','row_status','title_candidate','raw_price','column_roles_json','raw_cells_json','product_id','notes'},
    'products': {'id','source_row_id','article','article_raw','brand','brand_id','brand_match_method','name','type','category','defects_json','volume_ml','volume_text','display_kind','size_width','size_height','size_unit','price_usd','price_multiplier','price_raw','currency','gender','gender_from_name','is_tester','is_sample','is_set','set_component_count','extra_info_json','raw_title','raw_cells_json','source_file','source_sheet','source_row_number','parse_confidence','needs_review','review_reasons_json'},
    'product_components': {'id','parent_product_id','sequence_no','brand','name','type','category','quantity','volume_ml','volume_text','gender','raw_component','needs_review','review_reasons_json'},
    'product_defects': {'id','product_id','defect_code'},
    'app_notifications': {'id','tg_id','kind','title','body','is_read','created_at'},
    'telegram_message_cleanup': {'id','chat_id','message_id','notification_id','delete_after','created_at'},
    'admins': {'tg_id'},
    'parse_errors': {'id','tg_id','file_id','row_index','raw_title','error_code','details'},
    'subscription_reminders': {'id','subscription_key_id','hours_before_expiry','sent_at'},
    'admin_logs': {'id','admin_tg_id','action','details','created_at'},
}

async def init_db():
    global _pool
    # Sanitize pool limits and honor .env instead of hard-coding maxsize=10.
    maxsize = max(1, settings.mysql_pool_size)
    minsize = max(0, min(settings.mysql_pool_minsize, maxsize))
    logger.info('Opening MySQL pool (minsize=%s, maxsize=%s)', minsize, maxsize)
    try:
        _pool = await aiomysql.create_pool(
            host=settings.mysql_host,
            port=settings.mysql_port,
            user=settings.mysql_user,
            password=settings.mysql_password,
            db=settings.mysql_database,
            charset='utf8mb4',
            autocommit=False,
            minsize=minsize,
            maxsize=maxsize,
            connect_timeout=12,
            pool_recycle=1800,
        )
    except Exception as exc:
        # MySQL error 1203 means no more connections are allowed for this account.
        if getattr(exc, 'args', ()) and exc.args[0] == 1203:
            raise RuntimeError(
                'MySQL отверг соединение (1203): исчерпан max_user_connections для этого пользователя. '
                'Остановите лишние экземпляры бота/скриптов, уменьшите MYSQL_POOL_SIZE в .env '
                'и при необходимости попросите хостинг освободить зависшие соединения или увеличить лимит.'
            ) from exc
        raise

    missing = []
    try:
        async with _pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute('SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=%s', (settings.mysql_database,))
                actual = {}
                for table, column in await cur.fetchall():
                    actual.setdefault(table, set()).add(column)
                for table, columns in REQUIRED_COLUMNS.items():
                    if table not in actual:
                        missing.append('таблица ' + table)
                    else:
                        for col in sorted(columns - actual[table]):
                            missing.append(table + '.' + col)
    except Exception:
        _pool.close()
        await _pool.wait_closed()
        _pool = None
        raise
    if missing:
        _pool.close()
        await _pool.wait_closed()
        _pool = None
        raise RuntimeError('Структура БД не соответствует приложению. Отсутствуют: ' + ', '.join(missing) + '. Импортируйте актуальную схему/патч вручную; бот не меняет БД автоматически.')

async def close_db():
    global _pool
    if _pool is not None:
        _pool.close(); await _pool.wait_closed(); _pool = None

def pool():
    if _pool is None: raise RuntimeError('БД не инициализирована')
    return _pool
