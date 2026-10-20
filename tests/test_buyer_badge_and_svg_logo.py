from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "htdocs"


def test_buyer_role_badge_is_neutral_and_theme_aware_like_seller():
    app_css = (WEB / "assets/app.css").read_text(encoding="utf-8")
    visual_css = (WEB / "assets/css/visual-system.css").read_text(encoding="utf-8")
    assert ".role-badge.buyer{color:var(--good)}" not in app_css
    assert "body .role-badge.buyer { color: var(--muted); border-color: var(--line); background: color-mix(in srgb, var(--panel) 84%, transparent); }" in visual_css


def test_navbar_uses_the_svg_logo_without_square_frame():
    header = (WEB / "components/header.php").read_text(encoding="utf-8")
    css = (WEB / "assets/css/visual-system.css").read_text(encoding="utf-8")
    assert 'src="assets/img/logo.svg?v=1"' in header
    assert (WEB / "assets/img/logo.svg").is_file()
    assert "body .topbar .brand-mark" in css
    assert "border-radius: 0 !important" in css and "box-shadow: none !important" in css
    assert "body:not(.light) .topbar .brand-logo { filter: brightness(0) invert(1); }" in css
    assert "body.light .topbar .brand-logo { filter: none; }" in css
