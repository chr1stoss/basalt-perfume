"""Backward-compatible import path for the canonical user-deletion queue worker."""
from bot.services.queues.user_deletion_queue import (
    QUEUE_DDL,
    _admin_contact_url,
    _claim_next,
    _deleted_user_notice_keyboard,
    _remove_user_dir,
    _update_job,
    ensure_user_deletion_queue_table,
    process_user_deletion_queue,
)

__all__ = ["process_user_deletion_queue", "ensure_user_deletion_queue_table"]
