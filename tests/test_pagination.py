from bot.utils.pagination import paginate

def test_pages(): assert paginate(list(range(12)),2,5).items==[5,6,7,8,9]
def test_empty(): assert paginate([],1,5).pages==1
