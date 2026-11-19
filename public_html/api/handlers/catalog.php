<?php
if ($action === 'brands') {
    require_active_subscription($tgId);
    if (!empty($auth['is_admin'])) {
        $stmt=$pdo->query("SELECT DISTINCT p.brand FROM products p WHERE p.brand IS NOT NULL AND p.brand<>'' ORDER BY p.brand");
    } elseif ($auth['role'] === 'buyer') {
        $stmt=$pdo->query("SELECT DISTINCT p.brand FROM products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id LEFT JOIN user_settings seller_privacy ON seller_privacy.tg_id=pl.owner_tg_id WHERE COALESCE(seller_privacy.seller_products_public,0)=1 AND p.brand IS NOT NULL AND p.brand<>'' ORDER BY p.brand");
    } else {
        $stmt=$pdo->prepare("SELECT DISTINCT p.brand FROM products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id WHERE pl.owner_tg_id=? AND p.brand IS NOT NULL AND p.brand<>'' ORDER BY p.brand"); $stmt->execute(array($tgId));
    }
    respond(true,$stmt->fetchAll(PDO::FETCH_COLUMN),200);
}
if ($action === 'filter_options') {
    require_active_subscription($tgId);
    $isAdmin = !empty($auth['is_admin']);
    $isBuyer = $auth['role'] === 'buyer' && !$isAdmin;
    $isSellerWithoutLists = $auth['role'] === 'seller' && !$isAdmin;
    if ($isSellerWithoutLists) {
        $ownListCount = $pdo->prepare('SELECT COUNT(*) FROM price_lists WHERE owner_tg_id=?');
        $ownListCount->execute(array($tgId));
        $isSellerWithoutLists = (int)$ownListCount->fetchColumn() === 0;
    }
    // Sellers who have not uploaded a single list can still browse other sellers'
    // explicitly public products. Sellers with their own lists stay privately scoped.
    $isPublicCatalogFallback = $isSellerWithoutLists;
    $globalCatalog = $isBuyer || $isAdmin || $isPublicCatalogFallback;
    if ($isAdmin) {
        $scope = '';
        $scopeArgs = array();
        $join = ' FROM products p';
    } elseif ($isBuyer || $isPublicCatalogFallback) {
        $scope = ' WHERE COALESCE(seller_privacy.seller_products_public,0)=1';
        $scopeArgs = array();
        $join = ' FROM products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id LEFT JOIN user_settings seller_privacy ON seller_privacy.tg_id=pl.owner_tg_id';
    } else {
        $scope = ' WHERE pl.owner_tg_id=?';
        $scopeArgs = array($tgId);
        $join = ' FROM products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id';
    }
    $stmt=$pdo->prepare('SELECT DISTINCT p.brand'.$join.$scope.($scope ? ' AND' : ' WHERE')." p.brand IS NOT NULL AND p.brand<>'' ORDER BY p.brand"); $stmt->execute($scopeArgs); $brands=$stmt->fetchAll(PDO::FETCH_COLUMN);
    $stmt=$pdo->prepare('SELECT DISTINCT p.volume_ml'.$join.$scope.($scope ? ' AND' : ' WHERE')." p.volume_ml IS NOT NULL AND UPPER(COALESCE(p.type,'')) NOT IN ('SHOWCARD','BILLBOARD') ORDER BY p.volume_ml"); $stmt->execute($scopeArgs); $volumes=$stmt->fetchAll(PDO::FETCH_COLUMN);
    $stmt=$pdo->prepare('SELECT DISTINCT p.size_width,p.size_height,p.size_unit'.$join.$scope.($scope ? ' AND' : ' WHERE')." p.size_width IS NOT NULL AND p.size_height IS NOT NULL AND p.size_unit IS NOT NULL AND UPPER(COALESCE(p.type,'')) IN ('SHOWCARD','BILLBOARD') ORDER BY p.size_width,p.size_height,p.size_unit"); $stmt->execute($scopeArgs); $sizeRows=$stmt->fetchAll(); $sizes=array();
    foreach($sizeRows as $sizeRow){$sw=rtrim(rtrim(number_format((float)$sizeRow['size_width'],3,'.',''),'0'),'.');$sh=rtrim(rtrim(number_format((float)$sizeRow['size_height'],3,'.',''),'0'),'.');$unit=(string)$sizeRow['size_unit'];$sizes[]=array('value'=>'size:'.$sw.':'.$sh.':'.$unit,'label'=>$sw.' × '.$sh.' '.$unit);}
    $stmt=$pdo->prepare('SELECT DISTINCT p.type'.$join.$scope.($scope ? ' AND' : ' WHERE')." p.type IS NOT NULL AND p.type<>'' ORDER BY p.type"); $stmt->execute($scopeArgs); $types=$stmt->fetchAll(PDO::FETCH_COLUMN);
    if ($isAdmin) {
        $fileStmt=$pdo->query("SELECT pl.id,CONCAT(pl.filename,' · ',COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,''))),''),u.username,CONCAT('ID ',pl.owner_tg_id))) AS filename,pl.status,pl.imported_at FROM price_lists pl LEFT JOIN users u ON u.tg_id=pl.owner_tg_id ORDER BY pl.imported_at DESC,pl.id DESC");
        $files=$fileStmt->fetchAll();
    } elseif ($globalCatalog) $files=array(); else { $stmt=$pdo->prepare('SELECT id,filename,status,imported_at FROM price_lists WHERE owner_tg_id=? ORDER BY imported_at DESC,id DESC'); $stmt->execute(array($tgId)); $files=$stmt->fetchAll(); }
    $stmt=$pdo->prepare('SELECT DISTINCT p.gender'.$join.$scope.($scope ? ' AND' : ' WHERE').' p.gender IS NOT NULL ORDER BY p.gender'); $stmt->execute($scopeArgs); $genders=$stmt->fetchAll(PDO::FETCH_COLUMN);
    $stmt=$pdo->prepare('SELECT DISTINCT p.category'.$join.$scope.($scope ? ' AND' : ' WHERE').' p.category IS NOT NULL ORDER BY p.category'); $stmt->execute($scopeArgs); $categories=$stmt->fetchAll(PDO::FETCH_COLUMN);
    $sellers=array();
    if ($isBuyer || $isAdmin || $isPublicCatalogFallback) {
        $sellerStmt=$pdo->query("SELECT DISTINCT u.tg_id,u.username,TRIM(CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,''))) AS full_name,COALESCE(seller_privacy.seller_products_public,0) AS seller_products_public,COALESCE(seller_privacy.seller_dm_enabled,0) AS seller_dm_enabled,(SELECT COUNT(*) FROM products pcount JOIN source_rows srcount ON srcount.id=pcount.source_row_id JOIN price_lists plcount ON plcount.id=srcount.price_list_id WHERE plcount.owner_tg_id=u.tg_id) AS product_count,CASE WHEN COALESCE(seller_privacy.seller_products_public,0)=1 THEN 0 ELSE 1 END AS privacy_order FROM price_lists pl JOIN users u ON u.tg_id=pl.owner_tg_id LEFT JOIN user_settings seller_privacy ON seller_privacy.tg_id=pl.owner_tg_id ORDER BY privacy_order ASC,full_name,u.username");
        $sellers=$sellerStmt->fetchAll();
        foreach($sellers as &$sellerRow){
            $isPrivate = (int)$sellerRow['seller_products_public'] !== 1;
            $sellerRow['is_private'] = (!$isAdmin && $isPrivate) ? 1 : 0;
            // Keep a separate public flag for the search UI's public product count;
            // do not expose the raw privacy/settings columns themselves.
            $sellerRow['is_public'] = (int)$sellerRow['seller_products_public'] === 1 ? 1 : 0;
            $sellerRow['seller_dm_available'] = ($isAdmin || (!$isPrivate && (int)$sellerRow['seller_dm_enabled'] === 1)) ? 1 : 0;
            if ($isAdmin) {
                $sellerRow['tg_id']=(int)$sellerRow['tg_id'];
                if(trim((string)$sellerRow['full_name'])==='')$sellerRow['full_name']=$sellerRow['username']?'@'.$sellerRow['username']:'ID '.$sellerRow['tg_id'];
            } elseif ($isPrivate) {
                // Never expose a private seller's Telegram ID, real name or username.
                $sellerRow['tg_id']=0;
                $sellerRow['username']=null;
                $sellerRow['full_name']='Продавец-'.str_pad((string)random_int(0,999999),6,'0',STR_PAD_LEFT);
                $sellerRow['seller_dm_available']=0;
            } else {
                $sellerRow['tg_id']=(int)$sellerRow['tg_id'];
                $sellerRow['username']=null; // buyer must not see @username
                if(trim((string)$sellerRow['full_name'])==='')$sellerRow['full_name']='Продавец';
            }
            unset($sellerRow['seller_products_public'],$sellerRow['seller_dm_enabled'],$sellerRow['privacy_order']);
        } unset($sellerRow);
    }
    $defectRowsStmt=$pdo->prepare('SELECT DISTINCT pd.defect_code'.$join.' JOIN product_defects pd ON pd.product_id=p.id'.$scope.($scope ? ' AND' : ' WHERE')." pd.defect_code<>'' ORDER BY pd.defect_code");
    $defectRowsStmt->execute($scopeArgs); $defects=$defectRowsStmt->fetchAll(PDO::FETCH_COLUMN);
    $priceExpr = $globalCatalog ? 'p.price_usd*p.price_multiplier' : 'p.price_usd';
    $stmt=$pdo->prepare('SELECT MIN('.$priceExpr.') AS min_price,MAX('.$priceExpr.') AS max_price'.$join.$scope.($scope ? ' AND' : ' WHERE').' p.price_usd IS NOT NULL'); $stmt->execute($scopeArgs); $priceBounds=$stmt->fetch();
    respond(true,array('brands'=>$brands,'volumes'=>$volumes,'sizes'=>$sizes,'types'=>$types,'files'=>$files,'genders'=>$genders,'categories'=>$categories,'defects'=>$defects,'sellers'=>$sellers,'public_catalog_fallback'=>$isPublicCatalogFallback,'min_price'=>$priceBounds ? $priceBounds['min_price'] : null,'max_price'=>$priceBounds ? $priceBounds['max_price'] : null),200);
}
if ($action === 'products' || $action === 'best_prices') {
    require_active_subscription($tgId);
    $q = isset($input['q']) ? trim((string)$input['q']) : '';
    $readFilterValues = function($key) use ($input) {
        if (!isset($input[$key])) return array();
        $raw = is_array($input[$key]) ? $input[$key] : array($input[$key]);
        $values = array();
        foreach ($raw as $value) {
            if (!is_scalar($value)) continue;
            $value = trim((string)$value);
            if ($value === '' || in_array($value, $values, true)) continue;
            $values[] = $value;
            if (count($values) >= 100) break;
        }
        return $values;
    };
    $brandValues = $readFilterValues('brand');
    $typeValues = $readFilterValues('type');
    $volumeValues = $readFilterValues('volume');
    $fileValues = $readFilterValues('file_id');
    $genderValues = $readFilterValues('gender');
    $categoryValues = $readFilterValues('category');
    $reviewValues = $readFilterValues('needs_review');
    $defectValues = $readFilterValues('defects');
    $tester = isset($input['tester']) && $input['tester'] !== '' ? (int)$input['tester'] : null;
    $setOnly = isset($input['is_set']) && $input['is_set'] !== '' ? (int)$input['is_set'] : null;
    if ($auth['role'] === 'buyer' || !empty($auth['is_admin'])) $fileValues = array();
    $sellerIds=array();
    $isSellerWithoutLists = $auth['role'] === 'seller' && empty($auth['is_admin']);
    if ($isSellerWithoutLists) {
        $ownListCount = $pdo->prepare('SELECT COUNT(*) FROM price_lists WHERE owner_tg_id=?');
        $ownListCount->execute(array($tgId));
        $isSellerWithoutLists = (int)$ownListCount->fetchColumn() === 0;
    }
    $isPublicCatalogFallback = $isSellerWithoutLists;
    if (($auth['role']==='buyer' || !empty($auth['is_admin']) || $isPublicCatalogFallback) && isset($input['seller_ids']) && is_array($input['seller_ids'])) {
        foreach($input['seller_ids'] as $sellerId){$sellerId=(int)$sellerId;if($sellerId>0&&!in_array($sellerId,$sellerIds,true))$sellerIds[]=$sellerId;if(count($sellerIds)>=100)break;}
    }
    $minPrice = isset($input['min_price']) && $input['min_price'] !== '' ? (float)$input['min_price'] : null;
    $maxPrice = isset($input['max_price']) && $input['max_price'] !== '' ? (float)$input['max_price'] : null;
    $sort = isset($input['sort']) ? (string)$input['sort'] : 'price_asc';
    $priceExpr = ($auth['role'] === 'buyer' || !empty($auth['is_admin']) || $isPublicCatalogFallback) ? '(p.price_usd * p.price_multiplier)' : 'p.price_usd';
    $sortSql = $priceExpr.' ASC';
    if ($sort === 'price_desc') $sortSql=$priceExpr.' DESC'; elseif ($sort === 'name') $sortSql='p.name ASC'; elseif ($sort === 'name_desc') $sortSql='p.name DESC'; elseif ($sort === 'volume') $sortSql="(CASE WHEN UPPER(COALESCE(p.type,'')) IN ('DISPLAY','SHOWCARD','BILLBOARD') THEN (CASE WHEN p.size_unit='mm' THEN COALESCE(p.size_width,0)*COALESCE(p.size_height,0)/100 ELSE COALESCE(p.size_width,0)*COALESCE(p.size_height,0) END) ELSE COALESCE(p.volume_ml,0) END) ASC"; elseif ($sort === 'newest') $sortSql='pl.imported_at DESC,pl.id DESC'; elseif ($sort === 'oldest') $sortSql='pl.imported_at ASC,pl.id ASC';
    $globalCatalog = $auth['role'] === 'buyer' || !empty($auth['is_admin']) || $isPublicCatalogFallback;
    $isPublicCatalogViewer = ($auth['role'] === 'buyer' && empty($auth['is_admin'])) || $isPublicCatalogFallback;
    $where = $globalCatalog ? '1=1' : 'pl.owner_tg_id=?'; $args=$globalCatalog ? array() : array($tgId);
    if ($isPublicCatalogViewer) $where .= ' AND EXISTS (SELECT 1 FROM user_settings seller_privacy WHERE seller_privacy.tg_id=pl.owner_tg_id AND COALESCE(seller_privacy.seller_products_public,0)=1)';
    if ($q !== '') { $where .= ' AND (p.name LIKE ? OR p.brand LIKE ? OR p.article LIKE ? OR p.raw_title LIKE ?)'; $like='%'.$q.'%'; $args[]=$like; $args[]=$like; $args[]=$like; $args[]=$like; }
    $appendInFilter = function($column, $values) use (&$where, &$args) {
        if (!$values) return;
        $where .= ' AND '.$column.' IN ('.implode(',', array_fill(0, count($values), '?')).')';
        foreach ($values as $value) $args[] = $value;
    };
    $appendInFilter('p.brand', $brandValues);
    $appendInFilter('p.type', $typeValues);
    if ($volumeValues) {
        $measureParts = array(); $measureArgs = array(); $plainVolumes = array();
        foreach ($volumeValues as $measureValue) {
            if (preg_match('/^size:([0-9]+(?:\.[0-9]+)?):([0-9]+(?:\.[0-9]+)?):(mm|cm)$/', $measureValue, $measureMatch)) {
                $measureParts[] = '(p.size_width=? AND p.size_height=? AND p.size_unit=?)';
                $measureArgs[] = (float)$measureMatch[1]; $measureArgs[] = (float)$measureMatch[2]; $measureArgs[] = $measureMatch[3];
            } elseif (is_numeric($measureValue)) $plainVolumes[] = (float)$measureValue;
        }
        if ($plainVolumes) {
            $measureParts[] = 'p.volume_ml IN ('.implode(',', array_fill(0, count($plainVolumes), '?')).')';
            foreach ($plainVolumes as $plainVolume) $measureArgs[] = $plainVolume;
        }
        if ($measureParts) { $where .= ' AND ('.implode(' OR ', $measureParts).')'; foreach ($measureArgs as $measureArg) $args[]=$measureArg; }
    }
    if ($tester !== null) { $where .= ' AND p.is_tester=?'; $args[]=$tester ? 1 : 0; }
    if ($setOnly !== null) { $where .= ' AND p.is_set=?'; $args[]=$setOnly ? 1 : 0; }
    if ($fileValues && $auth['role'] !== 'buyer') $appendInFilter('pl.id', array_map('intval', $fileValues));
    if ($sellerIds) { $where .= ' AND pl.owner_tg_id IN ('.implode(',',array_fill(0,count($sellerIds),'?')).')'; foreach($sellerIds as $sellerId)$args[]=$sellerId; }
    $appendInFilter('p.gender', $genderValues);
    $appendInFilter('p.category', $categoryValues);
    if ($reviewValues && $auth['role'] !== 'buyer') $appendInFilter('p.needs_review', array_map('intval', $reviewValues));
    if ($defectValues) {
        $hasNoDefects = in_array('__none__', $defectValues, true);
        $hasAllDefects = in_array('__all_defects__', $defectValues, true);
        $selectedDefects = array_values(array_filter($defectValues, function($value){ return $value !== '__none__' && $value !== '__all_defects__'; }));
        $defectParts = array();
        if ($hasNoDefects) $defectParts[] = 'NOT EXISTS (SELECT 1 FROM product_defects pd_none WHERE pd_none.product_id=p.id)';
        if ($hasAllDefects) $defectParts[] = 'EXISTS (SELECT 1 FROM product_defects pd_any WHERE pd_any.product_id=p.id AND pd_any.defect_code<>\'\')';
        if ($selectedDefects) {
            $defectParts[] = 'EXISTS (SELECT 1 FROM product_defects pd_filter WHERE pd_filter.product_id=p.id AND pd_filter.defect_code IN ('.implode(',', array_fill(0, count($selectedDefects), '?')).'))';
            foreach ($selectedDefects as $selectedDefect) $args[]=$selectedDefect;
        }
        if ($defectParts) $where .= ' AND ('.implode(' OR ', $defectParts).')';
    }
    if ($minPrice !== null) { $where .= ' AND '.$priceExpr.'>=?'; $args[]=$minPrice; }
    if ($maxPrice !== null) { $where .= ' AND '.$priceExpr.'<=?'; $args[]=$maxPrice; }

    $defectsSelect = "(SELECT GROUP_CONCAT(DISTINCT pd.defect_code ORDER BY pd.defect_code SEPARATOR '|') FROM product_defects pd WHERE pd.product_id=p.id) AS defects_codes";
    $baseSelect = ($auth['role'] === 'buyer' || $isPublicCatalogFallback)
        ? 'SELECT p.id,p.brand,p.name,p.type,p.category,p.volume_ml,p.volume_text,p.display_kind,p.size_width,p.size_height,p.size_unit,(p.price_usd*p.price_multiplier) AS price_usd,p.currency,p.gender,p.is_tester,p.is_set,0 AS needs_review,NULL AS defects_json,'.$defectsSelect.',NULL AS file_id,NULL AS filename'
        : 'SELECT p.id,p.brand,p.name,p.type,p.category,p.volume_ml,p.volume_text,p.display_kind,p.size_width,p.size_height,p.size_unit,p.price_usd,p.price_usd AS base_price,p.price_multiplier,(p.price_usd*p.price_multiplier) AS effective_price,p.price_raw,p.currency,p.gender,p.is_tester,p.is_set,p.needs_review,p.defects_json,'.$defectsSelect.',pl.id AS file_id,pl.filename';
    if ($action === 'best_prices') {
        $compareExpr = ($auth['role'] === 'buyer' || !empty($auth['is_admin']) || $isPublicCatalogFallback) ? '(p2.price_usd*p2.price_multiplier)' : 'p2.price_usd';
        $ownScope = $globalCatalog ? '1=1' : 'pl2.owner_tg_id=pl.owner_tg_id';
        if ($isPublicCatalogViewer) $ownScope .= ' AND EXISTS (SELECT 1 FROM user_settings seller_privacy2 WHERE seller_privacy2.tg_id=pl2.owner_tg_id AND COALESCE(seller_privacy2.seller_products_public,0)=1)';
        $sql=$baseSelect.' FROM products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id WHERE '.$where.' AND p.price_usd IS NOT NULL AND '.$priceExpr.'=(SELECT MIN('.$compareExpr.') FROM products p2 JOIN source_rows sr2 ON sr2.id=p2.source_row_id JOIN price_lists pl2 ON pl2.id=sr2.price_list_id WHERE '.$ownScope.' AND COALESCE(p2.brand,\'\')=COALESCE(p.brand,\'\') AND p2.name=p.name AND COALESCE(p2.type,\'\')=COALESCE(p.type,\'\') AND COALESCE(p2.volume_ml,0)=COALESCE(p.volume_ml,0) AND (CASE WHEN p2.size_unit=\'mm\' THEN COALESCE(p2.size_width,0)/10 ELSE COALESCE(p2.size_width,0) END)=(CASE WHEN p.size_unit=\'mm\' THEN COALESCE(p.size_width,0)/10 ELSE COALESCE(p.size_width,0) END) AND (CASE WHEN p2.size_unit=\'mm\' THEN COALESCE(p2.size_height,0)/10 ELSE COALESCE(p2.size_height,0) END)=(CASE WHEN p.size_unit=\'mm\' THEN COALESCE(p.size_height,0)/10 ELSE COALESCE(p.size_height,0) END) AND p2.is_tester=p.is_tester AND p2.is_set=p.is_set AND COALESCE(p2.gender,\'\')=COALESCE(p.gender,\'\')) ORDER BY '.$sortSql.',p.name LIMIT 100';
    } else {
        $sql=$baseSelect.' FROM products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id WHERE '.$where.' ORDER BY '.$sortSql.',p.name LIMIT 100';
    }
    $stmt=$pdo->prepare($sql); $stmt->execute($args); $productRows=$stmt->fetchAll();
    foreach ($productRows as &$catalogProductRow) {
        $codes = isset($catalogProductRow['defects_codes']) ? (string)$catalogProductRow['defects_codes'] : '';
        $catalogProductRow['defects'] = $codes === '' ? array() : array_values(array_filter(explode('|', $codes), 'strlen'));
        unset($catalogProductRow['defects_codes']);
        $catalogProductRow['public_catalog_fallback']=$isPublicCatalogFallback ? 1 : 0;
    } unset($catalogProductRow);
    if (in_array($auth['role'], array('buyer','seller'), true) || !empty($auth['is_admin'])) {
        ensure_user_favorites_table($pdo);
        $favStmt=$pdo->prepare('SELECT product_id FROM user_favorites WHERE user_tg_id=?'); $favStmt->execute(array($tgId));
        $favoriteIds=array(); foreach ($favStmt->fetchAll(PDO::FETCH_COLUMN) as $favId) $favoriteIds[(string)$favId]=true;
        foreach ($productRows as &$productRow) $productRow['is_favorite']=isset($favoriteIds[(string)$productRow['id']]) ? 1 : 0;
        unset($productRow);
    }
    respond(true,$productRows,200);
}
if ($action === 'product_details') {
    require_active_subscription($tgId);
    $productId=isset($input['product_id'])?(int)$input['product_id']:0;if($productId<1)respond(false,array('error'=>'invalid_product_id'),400);
    $isSellerWithoutLists = $auth['role'] === 'seller' && empty($auth['is_admin']);
    if ($isSellerWithoutLists) {
        $ownListCount = $pdo->prepare('SELECT COUNT(*) FROM price_lists WHERE owner_tg_id=?');
        $ownListCount->execute(array($tgId));
        $isSellerWithoutLists = (int)$ownListCount->fetchColumn() === 0;
    }
    $isPublicCatalogFallback = $isSellerWithoutLists;
    $globalCatalog=$auth['role']==='buyer'||!empty($auth['is_admin'])||$isPublicCatalogFallback;
    $sql="SELECT p.id,p.brand,p.name,p.type,p.category,p.volume_ml,p.volume_text,p.display_kind,p.size_width,p.size_height,p.size_unit,p.gender,p.article,p.raw_title,p.is_tester,p.is_set,p.price_usd AS base_price,p.price_multiplier,(p.price_usd*p.price_multiplier) AS effective_price,p.currency,p.needs_review,p.parse_confidence,pl.id AS file_id,pl.filename,pl.status AS file_status,pl.owner_tg_id AS seller_tg_id,u.username AS seller_username,u.first_name AS seller_first_name,u.last_name AS seller_last_name,COALESCE(seller_privacy.seller_products_public,0) AS seller_products_public,COALESCE(seller_privacy.seller_dm_enabled,0) AS seller_dm_enabled FROM products p JOIN source_rows sr ON sr.id=p.source_row_id JOIN price_lists pl ON pl.id=sr.price_list_id LEFT JOIN users u ON u.tg_id=pl.owner_tg_id LEFT JOIN user_settings seller_privacy ON seller_privacy.tg_id=pl.owner_tg_id WHERE p.id=?";
    $args=array($productId);if(!$globalCatalog){$sql.=' AND pl.owner_tg_id=?';$args[]=$tgId;}elseif(($auth['role']==='buyer'&&empty($auth['is_admin']))||$isPublicCatalogFallback){$sql.=' AND COALESCE(seller_privacy.seller_products_public,0)=1';}$sql.=' LIMIT 1';$st=$pdo->prepare($sql);$st->execute($args);$product=$st->fetch();if(!$product)respond(false,array('error'=>'product_not_found','message'=>'Товар не найден или недоступен.'),404);
    $product['public_catalog_fallback']=$isPublicCatalogFallback ? 1 : 0;$product['can_favorite']=(in_array($auth['role'],array('buyer','seller'),true)||!empty($auth['is_admin']));$product['is_favorite']=0;
    if($product['can_favorite']){ensure_user_favorites_table($pdo);$f=$pdo->prepare('SELECT 1 FROM user_favorites WHERE user_tg_id=? AND product_id=?');$f->execute(array($tgId,$productId));$product['is_favorite']=$f->fetchColumn()?1:0;}
    $product['seller_tg_id']=(int)$product['seller_tg_id'];$product['seller_name']=trim((string)$product['seller_first_name'].' '.(string)$product['seller_last_name']);
    $product['seller_dm_available']=(!empty($auth['is_admin']) || ((int)$product['seller_products_public']===1 && (int)$product['seller_dm_enabled']===1))?1:0;
    if (empty($auth['is_admin']) && (int)$product['seller_dm_available']!==1) {
        $product['seller_username']=null;
        $product['seller_tg_id']=0;
    }
    unset($product['seller_first_name'],$product['seller_last_name'],$product['seller_products_public'],$product['seller_dm_enabled']);
    $defectStmt=$pdo->prepare('SELECT defect_code FROM product_defects WHERE product_id=? ORDER BY defect_code');
    $defectStmt->execute(array($productId)); $product['defects']=$defectStmt->fetchAll(PDO::FETCH_COLUMN);
    $product['set_components']=array();
    if ((int)$product['is_set'] === 1) {
        $componentStmt=$pdo->prepare('SELECT brand,name,type,category,quantity,volume_ml,volume_text,gender FROM product_components WHERE parent_product_id=? ORDER BY sequence_no,id');
        $componentStmt->execute(array($productId)); $product['set_components']=$componentStmt->fetchAll();
    }
    respond(true,$product,200);
}
