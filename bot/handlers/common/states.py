from bot.handlers.common.deps import State, StatesGroup

class Activation(StatesGroup):
    waiting_key = State()
