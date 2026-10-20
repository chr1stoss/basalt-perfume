from dataclasses import dataclass
from math import ceil
from typing import Generic, Sequence, TypeVar
T=TypeVar('T')
@dataclass(frozen=True)
class Page(Generic[T]):
    items: list[T]
    page: int
    per_page: int
    pages: int
    total: int

def paginate(items: Sequence[T], page: int=1, per_page: int=20) -> Page[T]:
    per_page=max(1,int(per_page)); total=len(items); pages=max(1,ceil(total/per_page)); page=min(max(1,int(page)),pages)
    start=(page-1)*per_page
    return Page(list(items[start:start+per_page]),page,per_page,pages,total)
