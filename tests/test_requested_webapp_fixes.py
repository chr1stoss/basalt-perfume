from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def test_modal_scrolls_inside_content_and_uses_theme_palette():
    app_css = (ROOT / "htdocs/assets/app.css").read_text(encoding="utf-8")
    modal_css = (ROOT / "htdocs/assets/css/modals.css").read_text(encoding="utf-8")
    visual = (ROOT / "htdocs/assets/css/visual-system.css").read_text(encoding="utf-8")
    assert ".admin-user-modal,.boost-modal{overflow:hidden" in app_css
    assert "body .boost-modal, body .admin-user-modal { overflow:hidden; }" in modal_css
    assert "background: var(--accent);" in visual
    assert "#ffd34b" not in visual

def test_price_multiplier_keyboard_has_five_steps_per_direction():
    js = (ROOT / "htdocs/assets/app.js").read_text(encoding="utf-8")
    for value in ["0.1", "0.5", "1", "2.5", "10", "-0.1", "-0.5", "-1", "-2.5", "-10"]:
        assert f'data-boost-delta="{value}"' in js

def test_admin_profiles_are_read_only_on_client_and_server():
    js = (ROOT / "htdocs/assets/app.js").read_text(encoding="utf-8")
    actions = (ROOT / "htdocs/actions/admin_users.php").read_text(encoding="utf-8")
    assert "var isTargetAdmin=!!u.is_admin||role==='admin'" in js
    assert "banDetails.inert=true" in js
    assert "!empty($input['ban'])" in actions and "admin_profile_readonly" in actions

def test_bot_preview_and_bulk_download_commands_exist():
    router = "\n".join(p.read_text(encoding="utf-8") for p in (ROOT / "bot/handlers").rglob("*.py"))
    assert '@router.message(Command("test"))' in router
    assert 'preview=1' in router
    assert '@router.message(Command("download_all"))' in router

def test_shell_and_preview_code_are_split_into_components():
    site = ROOT / "htdocs"
    assert (site / "components/header.php").is_file()
    assert (site / "components/navbar.php").is_file()
    assert (site / "actions/cache_avatar.php").is_file()
    assert (site / "assets/js/features/preview.js").is_file()
    index = (site / "index.php").read_text(encoding="utf-8")
    assert "components/header.php" in index and "components/navbar.php" in index
