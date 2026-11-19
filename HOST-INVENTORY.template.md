# Basalt Perfume — Production Host Inventory (fill on server)

Do not put passwords, tokens, private keys, database dumps, session IDs, or secret values in this file. Store only versions, hostnames where safe, non-secret paths, and capability status.

| Component | Actual value | How to verify |
|---|---|---|
| Hosting provider / plan | TODO | Sweb panel |
| DocumentRoot | TODO | hosting panel / `pwd` |
| Apache version | TODO | `apachectl -v` |
| Apache `mod_rewrite` | TODO | `apachectl -M` |
| Apache `mod_headers` | TODO | `apachectl -M` |
| PHP web SAPI/version | TODO | hosting panel / temporary protected phpinfo |
| PHP CLI version | TODO | `php -v` |
| PHP extensions | TODO | `php -m` |
| PHP `upload_max_filesize` | TODO | `php -i` / panel |
| PHP `post_max_size` | TODO | `php -i` / panel |
| Python version | TODO | `python3 --version` |
| SSH access / expiry | TODO | Sweb panel |
| Cron timezone | TODO | hosting panel / `date` |
| Cron schedule | TODO | `crontab -l` |
| MySQL/MariaDB version | TODO | `SELECT VERSION()` |
| DB distribution | TODO | `SELECT @@version_comment` |
| DB charset / collation | TODO | `SELECT @@character_set_server, @@collation_server` |
| DB SQL mode | TODO | `SELECT @@sql_mode` |
| DB max packet | TODO | `SELECT @@max_allowed_packet` |
| Private worker path | TODO | configured deployment path |
| Upload storage path | TODO | PHP config + worker `.env` (same absolute path) |
| Worker log path | TODO | worker `.env` |
| Cloudflare Worker name / URL | TODO | Cloudflare dashboard (URL is not secret) |
| Bot username | TODO | BotFather |
| Mini App URL | TODO | BotFather |
| OIDC Redirect URI | TODO | BotFather |
