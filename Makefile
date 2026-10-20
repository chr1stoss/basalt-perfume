.DEFAULT_GOAL := help
.PHONY: help install run test check pre-commit docker-up docker-down docker-logs clean

help: ## Show available development commands
	@grep -E '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "%-16s %s\n", $$1, $$2}'

install: ## Install project dependencies in the active Python environment
	python -m pip install --upgrade pip
	python -m pip install -r requirements.txt

run: ## Run the Telegram bot
	python main.py

test: ## Run pytest
	python -m pytest -q

check: ## Run Python and sibling WebApp syntax checks when tools are available
	python -m compileall -q main.py bot tests
	@if command -v node >/dev/null 2>&1 && [ -f ../basalt-parfume-php/assets/app.js ]; then node --check ../basalt-parfume-php/assets/app.js; else echo 'WebApp JS check skipped: extract the PHP WebApp release alongside this bot'; fi
	@if command -v php >/dev/null 2>&1 && [ -f ../basalt-parfume-php/index.php ]; then find ../basalt-parfume-php -type f -name '*.php' -print0 | xargs -0 -n1 php -l; else echo 'WebApp PHP check skipped: extract the PHP WebApp release alongside this bot'; fi

pre-commit: ## Run configured pre-commit hooks against all files
	pre-commit run --all-files

docker-up: ## Build and start the local database and bot
	docker compose up -d --build

docker-down: ## Stop the local database and bot (data volume is preserved)
	docker compose down

docker-logs: ## Follow logs for bot service
	docker compose logs -f bot

clean: ## Remove Python bytecode and test caches
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
	find . -type f -name '*.py[co]' -delete
	rm -rf .pytest_cache .mypy_cache .ruff_cache
