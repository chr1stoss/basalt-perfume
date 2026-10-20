from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "htdocs"


def test_admin_checkbox_favorites_alignment_counts_and_filter_spacing_are_final_overrides():
    app = (WEB / "assets/app.js").read_text(encoding="utf-8")
    css = (WEB / "assets/css/preview.css").read_text(encoding="utf-8")
    assert 'class="admin-permanent"' in app
    assert 'admin-permanent seller-filter-option' not in app
    assert '.admin-permanent.selected .seller-filter-checkbox' in css
    assert '#app .home-catalog-stats.buyer-stats > button.favorites-stat-card' in css
    assert '.seller-filter-menu .seller-filter-option .seller-product-count' in css
    assert '.filter-modal .filter-grid { margin-bottom: 6px' in css
    assert '.hero .status-label' in css


def test_subscription_progress_uses_activation_and_expiry_interval_without_increasing_denominator_to_remaining_time():
    app = (WEB / "assets/app.js").read_text(encoding="utf-8")
    api = (WEB / "api.php").read_text(encoding="utf-8")
    assert 'var measuredDuration=isFinite(activatedTs)&&isFinite(expiresTs)&&expiresTs>activatedTs' in app
    assert 'secondsLeft/durationSeconds*100' in app
    assert 'durationSeconds=Math.max(durationSeconds,secondsLeft)' not in app
    assert 'TIMESTAMPDIFF(SECOND,activated_at,available_until)' in api
    assert '.subscription-card .progress > span' in (WEB / "assets/css/preview.css").read_text(encoding="utf-8")


def test_admin_key_assignment_updates_role_and_protects_existing_admin_profiles():
    api = (WEB / "api.php").read_text(encoding="utf-8")
    assert 'role_on_activate,key_prefix FROM subscription_keys WHERE id=? FOR UPDATE' in api
    assert "UPDATE users SET role=? WHERE tg_id=?" in api
    assert "INSERT IGNORE INTO admins(tg_id) VALUES(?)" in api


def test_delete_user_is_confirmed_queued_and_cleans_related_database_records():
    api_action = (WEB / "actions/admin_users.php").read_text(encoding="utf-8")
    app = (WEB / "assets/app.js").read_text(encoding="utf-8")
    bot_worker = (ROOT / "bot/services/queues/user_deletion_queue.py").read_text(encoding="utf-8")
    assert "if ($action === 'admin_delete_user')" in api_action
    assert "cannot_delete_admin" in api_action and "cannot_delete_self" in api_action
    assert "DELETE FROM subscription_keys WHERE used_by_tg_id=? OR owner_tg_id=?" in api_action
    assert "admin_delete_user" in app.split("var writeActions", 1)[1].split("];", 1)[0]
    assert "DELETE FROM price_lists WHERE owner_tg_id=?" in api_action
    assert "admin_user_deletion_queue" in api_action
    assert "Удалить (5)" in app and "cancelDelete.onclick=resetDeleteConfirm" in app
    assert "_remove_user_dir(job[\"tg_id\"])" in bot_worker
    assert "Ваш аккаунт был удалён администрацией" in bot_worker


def test_queue_migration_is_in_php_bot_and_both_full_dumps():
    migration = (WEB / "migrations/006_admin_user_deletion_queue.sql").read_text(encoding="utf-8")
    bot_migration = (ROOT / "bot/database/migrations/006_admin_user_deletion_queue.sql").read_text(encoding="utf-8")
    empty = (ROOT / "bot/database/dumps/14_full_install_empty_brands.sql").read_text(encoding="utf-8")
    brands = (ROOT / "bot/database/dumps/15_full_install_with_brands.sql").read_text(encoding="utf-8")
    for text in (migration, bot_migration, empty, brands):
        assert "CREATE TABLE IF NOT EXISTS admin_user_deletion_queue" in text
    for text in (empty, brands):
        assert "`admin_user_deletion_queue`" in text.split("DROP TABLE IF EXISTS", 1)[1].split(";", 1)[0]


def test_admin_cli_has_role_synchronized_key_assignment_and_confirmed_deletion_commands():
    cli = (ROOT / "admin-cli.py").read_text(encoding="utf-8")
    assert 'sub.add_parser("change-user-key"' in cli
    assert 'sub.add_parser("delete-user"' in cli
    assert 'await cur.execute("UPDATE users SET role=%s WHERE tg_id=%s", (role_value, args.user_id))' in cli
    assert 'args.confirm != str(args.user_id)' in cli
