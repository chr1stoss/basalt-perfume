"""Lifecycle checks for Telegram notices and background queues."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_temporary_notice_cleanup_uses_two_attempts_and_logs_terminal_failures():
    ephemeral = (ROOT / "bot/handlers/common/notifications/ephemeral.py").read_text(encoding="utf-8")
    service = (ROOT / "bot/services/notifications/telegram.py").read_text(encoding="utf-8")
    block = ephemeral.split("async def _delete_message_after", 1)[1]
    assert "for attempt in range(1, 3)" in block
    assert "retrying once" in block
    assert "MAX_DELETE_ATTEMPTS = 2" in service
    assert "Abandoning Telegram cleanup row" in service


def test_notification_service_sends_photo_and_handles_expired_telegram_messages():
    service = (ROOT / "bot/services/notifications/telegram.py").read_text(encoding="utf-8")
    handlers = "\n".join(path.read_text(encoding="utf-8") for path in (ROOT / "bot/handlers").rglob("*.py"))
    assert "send_photo" in service
    assert "INTERVAL 1 MINUTE" in service
    assert "cleanup_expired_telegram_messages" in service
    assert 'callback_data="read:" + str(notification_id)' in service
    assert 'F.data.startswith("read:")' in handlers
    assert "UPDATE app_notifications SET is_read=1" in handlers


def test_announcement_queue_worker_has_a_startup_entry_point_and_db_guard():
    service = (ROOT / "bot/services/queues/announcement_queue.py").read_text(encoding="utf-8")
    main = (ROOT / "main.py").read_text(encoding="utf-8")
    assert "async def process_announcement_queue(bot: Bot)" in service
    assert "FROM information_schema.tables" in service
    assert '"telegram_notification_queue"' in service
    assert "announcement_queue_task=asyncio.create_task" in main
    assert (ROOT / "bot/database/migrations/09_telegram_notification_queue.sql").is_file()


def test_user_deletion_queue_removes_user_files_and_checks_table_before_worker_start():
    service = (ROOT / "bot/services/queues/user_deletion_queue.py").read_text(encoding="utf-8")
    assert "FROM information_schema.tables" in service
    assert '"admin_user_deletion_queue"' in service
    assert 'if not await cur.fetchone():' in service
    assert '_remove_user_dir(job["tg_id"])' in service
    assert "Ваш аккаунт был удалён администрацией" in service


def test_bot_events_use_maintenance_middleware_for_messages_and_callbacks():
    source = "\n".join(path.read_text(encoding="utf-8") for path in (ROOT / "bot/handlers").rglob("*.py"))
    assert "router.message.middleware(MaintenanceMiddleware())" in source
    assert "router.callback_query.middleware(MaintenanceMiddleware())" in source
