FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system basalt \
    && useradd --system --gid basalt --home-dir /app --shell /usr/sbin/nologin basalt

COPY requirements.txt ./requirements.txt
RUN python -m pip install --upgrade pip \
    && pip install -r requirements.txt

COPY --chown=basalt:basalt main.py ./main.py
COPY --chown=basalt:basalt bot/ ./bot/
RUN mkdir -p /app/bot/data && chown -R basalt:basalt /app/bot/data

USER basalt
CMD ["python", "main.py"]
