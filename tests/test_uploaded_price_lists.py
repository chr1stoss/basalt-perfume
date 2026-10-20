import os
from pathlib import Path
import pytest
from bot.services.parser.price_list import _load_engine_and_parse

PRICE_DIR=Path(os.getenv('BASALT_TEST_PRICE_DIR','/mnt/data'))
FILES=['NewPrice_21_07_2026.xls','на 17.07.xls','Прайс лист на 15 Июля.xlsx','PRICELIST CLEOPATRA 20.07.2026.xlsx']
@pytest.mark.parametrize('filename',FILES)
def test_uploaded_price_list_is_read_and_prices_are_sane(filename):
    path=PRICE_DIR/filename
    if not path.exists(): pytest.skip('Исходный прайс-лист не включён в репозиторий тестов')
    data=_load_engine_and_parse(path,filename)
    assert len(data['products'])>100
    assert all(float(p['price_usd'])<100000 for p in data['products'] if p.get('price_usd') is not None)
    assert len(data['source_rows'])>len(data['products'])
