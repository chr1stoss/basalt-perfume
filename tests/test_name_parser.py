from decimal import Decimal
from bot.services.parser.name_parser import parse_name, parse_price

def test_parser():
    p=parse_name('Dior Sauvage Eau de Parfum Homme 100 ml Tester')
    assert p.volume==100 and p.volume_text=='100 ml' and p.gender=='M' and p.is_tester and p.prod_type=='edp'

def test_price_guard():
    assert parse_price('20,70')==Decimal('20.70')
    assert parse_price('271059712') is None
    assert parse_price('not a price') is None
