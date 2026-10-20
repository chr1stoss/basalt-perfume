import asyncio
import logging
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from bot.config import settings
from bot.database.connection import init_db, close_db
from bot.handlers.router import router
from bot.services.notifications import cleanup_expired_telegram_messages
from bot.services.queues.announcement_queue import process_announcement_queue
from bot.services.queues.user_deletion_queue import process_user_deletion_queue
from collections.abc import AsyncGenerator
from aiogram.methods import GetUpdates
from aiogram.types import Update
from aiogram.utils.backoff import Backoff, BackoffConfig

DEFAULT_BACKOFF_CONFIG = BackoffConfig(
    min_delay=1.0,
    max_delay=5.0,
    factor=1.3,
    jitter=0.1,
)


class GracefulDispatcher(Dispatcher):
    @classmethod
    async def _listen_updates(
        cls,
        bot: Bot,
        polling_timeout: int = 30,
        backoff_config: BackoffConfig = DEFAULT_BACKOFF_CONFIG,
        allowed_updates: list[str] | None = None,
    ) -> AsyncGenerator[Update, None]:
        logger = logging.getLogger("aiogram.dispatcher")
        backoff = Backoff(config=backoff_config)

        get_updates = GetUpdates(
            timeout=polling_timeout,
            allowed_updates=allowed_updates,
        )

        kwargs = {}
        if bot.session.timeout:
            kwargs["request_timeout"] = int(
                bot.session.timeout + polling_timeout
            )

        failed = False

        while True:
            try:
                updates = await bot(get_updates, **kwargs)

            except asyncio.CancelledError:
                raise

            except Exception as exc:
                # При завершении процесса не пытаемся переподключаться.
                task = asyncio.current_task()
                if task is not None and task.cancelling():
                    raise asyncio.CancelledError from exc

                failed = True
                logger.error(
                    "Failed to fetch updates - %s: %s",
                    type(exc).__name__,
                    exc,
                )
                logger.warning(
                    "Sleep for %f seconds and try again "
                    "(tryings = %d, bot id = %d)",
                    backoff.next_delay,
                    backoff.counter,
                    bot.id,
                )
                await backoff.asleep()
                continue

            if failed:
                logger.info(
                    "Connection established "
                    "(tryings = %d, bot id = %d)",
                    backoff.counter,
                    bot.id,
                )
                backoff.reset()
                failed = False

            for update in updates:
                yield update
                get_updates.offset = update.update_id + 1

async def main():
    if not settings.bot_token: raise RuntimeError('BOT_TOKEN не задан в .env')
    if not settings.mysql_user or not settings.mysql_database: raise RuntimeError('MYSQL_USER и MYSQL_DATABASE должны быть заданы в .env')
    logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO),
                        format='%(asctime)s %(levelname)s %(name)s: %(message)s')
    await init_db()  # validates existing schema; intentionally creates no tables/migrations
    # Route only this bot process' Telegram Bot API traffic through an optional proxy.
    # Telegram Desktop/WebApp and MySQL continue to use their normal network routes.
    # Use an explicit deadline for ordinary Bot API calls. Long polling overrides this
    # with its own timeout in GracefulDispatcher._listen_updates.
    bot_session = AiohttpSession(proxy=settings.bot_proxy or None, timeout=settings.bot_api_timeout)
    bot_kwargs = {'default': DefaultBotProperties(parse_mode=ParseMode.HTML)}
    bot_kwargs['session'] = bot_session
    bot = Bot(settings.bot_token, **bot_kwargs)
    dp = GracefulDispatcher(storage=MemoryStorage())
    dp.include_router(router)
    cleanup_task=asyncio.create_task(cleanup_expired_telegram_messages(bot),name='telegram-notification-cleanup')
    announcement_queue_task=asyncio.create_task(process_announcement_queue(bot),name='telegram-announcement-queue')
    user_deletion_task=asyncio.create_task(process_user_deletion_queue(bot),name='admin-user-deletion-queue')
    try:
        # Equivalent to skip_updates=True: discard updates accumulated while the bot was offline.
        await bot.delete_webhook(drop_pending_updates=True)
        await dp.start_polling(
    	    bot,
    	    allowed_updates=dp.resolve_used_update_types(),
    	    close_bot_session=False,
	)
    finally:
        cleanup_task.cancel()
        announcement_queue_task.cancel()
        user_deletion_task.cancel()
        try: await cleanup_task
        except asyncio.CancelledError: pass
        try: await announcement_queue_task
        except asyncio.CancelledError: pass
        try: await user_deletion_task
        except asyncio.CancelledError: pass
        await close_db()
        await bot.session.close()

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        # asyncio.run() cancels the active task first, so main()'s finally block
        # closes the polling session and database pool before we exit quietly.
        print('\nОстановка Basalt Perfume…')
