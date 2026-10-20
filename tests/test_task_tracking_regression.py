from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_runtime_package_exports_the_same_public_names_as_context_including_task_state():
    source = (ROOT / "bot/handlers/common/runtime/__init__.py").read_text(encoding="utf-8")
    assert "from .context import __all__ as __all__" in source


def test_fast_start_imports_background_task_set_explicitly():
    source = (ROOT / "bot/handlers/common/menu/fast_start.py").read_text(encoding="utf-8")
    assert "from bot.handlers.common.runtime import _background_tasks" in source


def test_middleware_deletes_only_commands_that_it_blocks():
    source = (ROOT / "bot/handlers/common/middleware/guards.py").read_text(encoding="utf-8")
    command_branch = source.split('if command_text.startswith("/"):', 1)[1].split("if not user or await is_admin", 1)[0]
    assert 'schedule_delete_user_message(event)' in command_branch
    assert command_branch.index('if command_name == "/test"') < command_branch.index('schedule_delete_user_message(event)')
    assert command_branch.rstrip().endswith('return None')
    assert 'schedule_delete_user_message(event)\n                            await event.answer(notice)' in source


def test_user_settings_creation_does_not_emit_expected_duplicate_key_warnings():
    source = (ROOT / "bot/database/queries/users.py").read_text(encoding="utf-8")
    assert "INSERT IGNORE INTO user_settings" not in source
    assert "ON DUPLICATE KEY UPDATE tg_id=tg_id" in source


def test_show_view_can_replace_old_main_menu_without_editing_it():
    source = (ROOT / "bot/handlers/common/messages/views.py").read_text(encoding="utf-8")
    assert "if reuse_main and target and int(target[0]) == int(chat_id):" in source
    assert "if target and int(target[0]) == int(chat_id) and int(target[1]) != int(sent.message_id):" in source


def test_queue_workers_check_for_existing_tables_before_running_create_ddl():
    for rel, table in [
        ("bot/services/queues/announcement_queue.py", "telegram_notification_queue"),
        ("bot/services/queues/user_deletion_queue.py", "admin_user_deletion_queue"),
    ]:
        source = (ROOT / rel).read_text(encoding="utf-8")
        assert "FROM information_schema.tables" in source
        assert f'("{table}",)' in source
        assert "if not await cur.fetchone():" in source
