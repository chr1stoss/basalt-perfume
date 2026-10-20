import logging
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env')
log = logging.getLogger(__name__)


def _read_bot_proxy() -> str:
    raw = os.getenv('BOT_PROXY', '').strip()
    # A value like BOT_PROXY=#socks5://... is a commented-out line, not a URL.
    if not raw or raw.startswith('#'):
        return ''
    if ' #' in raw:
        raw = raw.split(' #', 1)[0].strip()
    raw = raw.strip().strip('\"').strip("'")
    try:
        parsed = urlsplit(raw)
        if parsed.scheme.lower() not in {'socks5', 'socks4', 'http', 'https'} or not parsed.hostname or parsed.port is None:
            raise ValueError('invalid proxy URL')
    except Exception:
        log.warning('BOT_PROXY is invalid; starting without a proxy. Set a full URL such as socks5://host:port.')
        return ''
    return raw

@dataclass(frozen=True)
class Settings:
    bot_token: str = os.getenv('BOT_TOKEN', '').strip()
    bot_username: str = os.getenv('BOT_USERNAME', 'basalt_perfume_bot').lstrip('@')
    webapp_url: str = os.getenv('WEBAPP_URL', '').strip()
    # Optional proxy used only for this bot's Telegram Bot API calls.
    bot_proxy: str = _read_bot_proxy()
    # A dead proxy should not stall a handler for aiogram's 60-second default.
    bot_api_timeout: float = max(5.0, min(30.0, float(os.getenv('BOT_API_TIMEOUT', '12'))))
    mysql_host: str = os.getenv('MYSQL_HOST', '127.0.0.1')
    mysql_port: int = int(os.getenv('MYSQL_PORT', '3306'))
    mysql_user: str = os.getenv('MYSQL_USER', '').strip()
    mysql_password: str = os.getenv('MYSQL_PASSWORD', '')
    mysql_database: str = os.getenv('MYSQL_DATABASE', '').strip()
    # Keep the DB pool small on shared hosting; override with MYSQL_POOL_SIZE if needed.
    mysql_pool_size: int = int(os.getenv('MYSQL_POOL_SIZE', '5'))
    mysql_pool_minsize: int = int(os.getenv('MYSQL_POOL_MINSIZE', '1'))
    admin_ids: tuple = tuple(int(x.strip()) for x in os.getenv('ADMIN_IDS', '').split(',') if x.strip().isdigit())
    data_dir: Path = Path(os.getenv('DATA_DIR', str(ROOT / 'bot' / 'data'))).resolve()
    max_file_size_mb: int = int(os.getenv('MAX_FILE_SIZE_MB', '20'))
    max_concurrent_files: int = int(os.getenv('MAX_CONCURRENT_FILES', '3'))
    log_level: str = os.getenv('LOG_LEVEL', 'INFO')

settings = Settings()
