# Development image. Production deployment on Sweb remains FTP/Apache + cron.
ARG PHP_VERSION=8.2
FROM php:${PHP_VERSION}-apache AS web
RUN apt-get update && apt-get install -y --no-install-recommends libcurl4-openssl-dev libonig-dev \
    && docker-php-ext-install pdo_mysql mbstring curl \
    && a2enmod rewrite headers \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /var/www/html
COPY public_html/ /var/www/html/
RUN chown -R www-data:www-data /var/www/html
EXPOSE 80

FROM python:3.12-slim AS worker
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/basalt
COPY requirements.txt /opt/basalt/requirements.txt
RUN pip install --no-cache-dir -r /opt/basalt/requirements.txt
COPY private/basalt-site-worker/ /opt/basalt/private/basalt-site-worker/
COPY public_html/scripts/web_upload_worker.py /opt/basalt/public_html/scripts/web_upload_worker.py
ENV BASALT_WORKER_ROOT=/opt/basalt/private/basalt-site-worker
CMD ["python", "/opt/basalt/public_html/scripts/web_upload_worker.py", "--check"]
