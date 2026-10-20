from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "htdocs"


def test_seller_without_lists_gets_public_catalog_and_filter_sellers():
    api = (WEB / "api.php").read_text(encoding="utf-8")
    app = (WEB / "assets/app.js").read_text(encoding="utf-8")
    assert "$isPublicCatalogFallback = $isSellerWithoutLists" in api
    assert "$where .= ' AND EXISTS (SELECT 1 FROM user_settings seller_privacy" in api
    assert "public_catalog_fallback" in api
    assert "var publicCatalogFallback=!!opts.public_catalog_fallback" in app
    assert "var buyerFilters = currentRole === 'buyer' || publicCatalogFallback" in app
    assert "var countVisible=Number(seller.is_public)===1&&seller.product_count!=null" in app
    assert "Всего товаров:" in app


def test_public_catalog_filter_size_and_volume_are_dynamic_and_ordered():
    api = (WEB / "api.php").read_text(encoding="utf-8")
    app = (WEB / "assets/app.js").read_text(encoding="utf-8")
    assert "NOT IN ('SHOWCARD','BILLBOARD')" in api
    assert "IN ('SHOWCARD','BILLBOARD')" in api
    assert "filterDropdown('Тип / концентрация', 'type', types)" in app
    assert "function refreshMeasureDropdown()" in app
    assert "var display=isDisplayType(selectedTypeInModal())" in app
    assert "localizedMeasureLabel(display)" in app


def test_buyer_subscription_link_and_favorites_dashboard_order_match_preview():
    app = (WEB / "assets/app.js").read_text(encoding="utf-8")
    assert "data-go=\"subscription\">Подписка" in app
    assert "home-catalog-stats '+(buyer?'buyer-stats':'')" in app
    preview = app[app.index("function renderVirtualScreen"):app.index("function openVirtualFavoritesModal")]
    buyer_block = preview[preview.index("if(role==='buyer')"):preview.index("}else if(role==='seller')")]
    assert buyer_block.index("Товаров в каталоге") < buyer_block.index("Новых уведомлений") < buyer_block.index("Дней осталось") < buyer_block.index("Избранное")
    assert "Последняя обработка" not in preview


def test_admin_key_order_has_the_four_requested_groups():
    api = (WEB / "api.php").read_text(encoding="utf-8")
    assert "usort($stats['keys_list']" in api
    assert "if ($readable) return $used ? 1 : 0" in api
    assert "return $used ? 3 : 2" in api


def test_favorite_contact_buttons_keep_label_and_are_inert_when_disabled():
    app = (WEB / "assets/app.js").read_text(encoding="utf-8")
    css = (WEB / "assets/css/preview.css").read_text(encoding="utf-8")
    assert 'favorite-share-disabled' in app and 'Поделиться списком' in app
    assert 'contact-seller-disabled' in app and 'Связаться с продавцом' in app
    assert '.favorite-share-disabled:hover' in css and '.contact-seller-disabled:active' in css
    assert 'favorite-seller-count' in app


def test_ban_mode_toggle_keeps_exactly_one_mode_visible_and_checkbox_is_custom():
    app = (WEB / "assets/app.js").read_text(encoding="utf-8")
    css = (WEB / "assets/css/preview.css").read_text(encoding="utf-8")
    assert 'class="admin-permanent"' in app and 'admin-permanent seller-filter-option' not in app
    assert 'function syncBanModeVisibility()' in app
    assert "schedule.classList.toggle('is-collapsed',permanent)" in app
    assert 'schedule.inert=permanent' in app
    assert "panel.getAttribute('data-ban-panel')!==banMode" in app
    assert '.admin-permanent .seller-filter-checkbox' in css


def test_theme_is_adopted_from_profile_before_lock_and_persisted_per_user():
    app = (WEB / "assets/app.js").read_text(encoding="utf-8")
    assert "function appearanceStorageKey()" in app
    assert "function adoptProfileAppearance(source)" in app
    assert "adoptProfileAppearance(p)" in app
    assert "root.classList.toggle('light',mode==='light')" in app
    assert "root.classList.remove('theme-'+themeName)" in app


def test_product_detail_orphan_field_and_subscription_status_outline():
    app = (WEB / "assets/app.js").read_text(encoding="utf-8")
    css = (WEB / "assets/css/preview.css").read_text(encoding="utf-8")
    assert "field('Продавец',sellerName)" in app
    assert "sizeOrphanDetailField" in app
    assert ".product-detail-field-auto-wide { grid-column:1 / -1" in css
    assert ".subscription-card .row > .status-label" in css and "border:1px solid var(--line)" in css


def test_boost_is_disabled_without_price_lists_and_nav_cache_bumped():
    app = (WEB / "assets/app.js").read_text(encoding="utf-8")
    index = (WEB / "index.php").read_text(encoding="utf-8")
    assert "var boostDisabled=currentRole==='seller'&&!files.length" in app
    assert "if(boost&&!boost.disabled)boost.onclick=openPriceBoostModal" in app
    assert 'assets/app.js?v=67' in index
    assert 'visual-system.css?v=44' in index


def test_bot_commands_cleanup_key_success_and_inert_keyboard_are_implemented():
    router = "\n".join(p.read_text(encoding="utf-8") for p in (ROOT / "bot/handlers").rglob("*.py"))
    assert 'command_name == "/test" and int(user.id if user else 0) not in settings.admin_ids' in router
    assert 'async def make_inline_keyboard_inert(event)' in router
    assert 'callback_data="locked_noop"' in router
    assert '@router.callback_query(F.data == "locked_noop")' in router
    receive_key = (ROOT / "bot/handlers/routers/subscription/activation.py").read_text(encoding="utf-8").split('async def receive_key', 1)[1]
    assert receive_key.index('await send_notice(bot, message.chat.id, message.from_user.id, tr(language, "key_success_title")') < receive_key.index('post-activation menu refresh failed')
    assert 'must not trigger the global failure alert/message' in receive_key


def test_current_version_is_packaged_separately_and_dumps_are_present():
    assert (ROOT / "bot/database/dumps/14_full_install_empty_brands.sql").is_file()
    assert (ROOT / "bot/database/dumps/15_full_install_with_brands.sql").is_file()
    assert (WEB / "index.php").is_file()
    assert not (ROOT / "htdocs").resolve().samefile(ROOT) if (ROOT / "htdocs").exists() else True


def test_public_seller_product_counts_survive_api_privacy_cleanup():
    api = (WEB / "api.php").read_text(encoding="utf-8")
    app = (WEB / "assets/app.js").read_text(encoding="utf-8")
    assert "$sellerRow['is_public'] = (int)$sellerRow['seller_products_public'] === 1 ? 1 : 0;" in api
    assert "Number(seller.is_public)===1&&seller.product_count!=null" in app
