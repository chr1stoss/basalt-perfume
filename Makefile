.PHONY: install test lint php-lint js-lint format docker-up docker-down worker-check

install:
	python -m pip install -r requirements-dev.txt
	pre-commit install

test:
	pytest

lint: php-lint js-lint
	python -m compileall -q private/basalt-site-worker public_html/scripts
	ruff check --select=E4,E7,E9,F private/basalt-site-worker/config.py tests

php-lint:
	find public_html -type f -name '*.php' -print0 | xargs -0 -n1 php -l

js-lint:
	node --check public_html/assets/app.js
	node --check public_html/assets/js/core/api.js
	node --check public_html/telegram-web-app.js
	node --input-type=module --check < public_html/telegram-oidc-relay/worker.js

format:
	ruff format private/basalt-site-worker tests
	ruff check --fix private/basalt-site-worker tests

docker-up:
	docker compose up --build

docker-down:
	docker compose down

worker-check:
	docker compose --profile worker run --rm worker python /opt/basalt/public_html/scripts/web_upload_worker.py --check
