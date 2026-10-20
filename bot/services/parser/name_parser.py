import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

@dataclass(frozen=True)
class ParsedName:
    brand: str | None
    name: str
    volume: int | float | None
    volume_text: str | None
    gender: str | None
    is_tester: bool
    prod_type: str | None

def parse_price(value):
    if value is None or isinstance(value,bool): return None
    text=str(value).strip().replace('\xa0',' ').replace(' ','')
    if not text: return None
    text=re.sub(r'(?i)(usd|eur|rub|rur|руб\.?|грн|у\.е\.|[$€₽])','',text)
    if ',' in text and '.' in text:
        if text.rfind(',')>text.rfind('.'): text=text.replace('.','').replace(',','.')
        else: text=text.replace(',','')
    elif ',' in text: text=text.replace(',','.')
    try: result=Decimal(text)
    except (InvalidOperation,ValueError): return None
    if not result.is_finite() or result<0 or result>Decimal('1000000'): return None
    return result.quantize(Decimal('0.01'))

def parse_name(value):
    raw=re.sub(r'\s+',' ',str(value or '').replace('\xa0',' ')).strip()
    vm=re.search(r'(?i)(\d+(?:[.,]\d+)?)\s*(ml|мл)\b',raw)
    volume=None; volume_text=None
    if vm:
        n=float(vm.group(1).replace(',','.')); volume=int(n) if n.is_integer() else n; volume_text=(str(volume)+' ml')
    gender='M' if re.search(r'(?i)\b(homme|men|man|мужской|муж)\b',raw) else ('F' if re.search(r'(?i)\b(women|woman|wom|женский|жен)\b',raw) else None)
    tester=bool(re.search(r'(?i)\btester\b|тестер',raw))
    typ=None
    for pat,canon in [(r'(?i)\b(edp|eau de parfum|парфюмированная вода)\b','edp'),(r'(?i)\b(edt|eau de toilette|туалетная вода)\b','edt'),(r'(?i)\b(edc|eau de cologne|одеколон)\b','edc'),(r'(?i)\b(extrait|parfum|духи)\b','parfum')]:
        if re.search(pat,raw): typ=canon; break
    name=raw
    if vm: name=name[:vm.start()]+' '+name[vm.end():]
    name=re.sub(r'(?i)\b(tester|тестер|homme|men|man|women|woman|wom|женский|мужской|edp|edt|edc|eau de parfum|eau de toilette|eau de cologne|парфюмированная вода|туалетная вода)\b',' ',name)
    name=re.sub(r'\s+',' ',name).strip(' -–—,;') or raw
    brand=None
    return ParsedName(brand,name,volume,volume_text,gender,tester,typ)
