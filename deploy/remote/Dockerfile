FROM python:3.12-slim
WORKDIR /srv
# Standalone image only; repository dependency manifests are not modified.
RUN pip install --no-cache-dir fastapi==0.141.1 uvicorn==0.52.4 websockets==17.0.1 \
    && groupadd --gid 10001 relay && useradd --uid 10001 --gid relay relay \
    && mkdir /data && chown relay:relay /data
COPY runtime/python/relay /srv/runtime/python/relay
COPY scripts/relay.py /srv/scripts/relay.py
USER 10001:10001
ENV RELAY_DB=/data/relay.sqlite3 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["python", "scripts/relay.py", "serve", "--bind", "0.0.0.0"]
