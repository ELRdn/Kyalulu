FROM node:22.14.0-bookworm-slim AS web
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web ./apps/web
COPY packages ./packages
RUN pnpm install --frozen-lockfile && pnpm --filter web build
FROM python:3.13.7-slim-bookworm AS sources
WORKDIR /src
COPY . .
COPY --from=web /src/node_modules/.pnpm ./node_modules/.pnpm
RUN python scripts/collect_release_sources.py /corresponding-source /kyalulu-source.tar.gz

FROM ghcr.io/astral-sh/uv:0.8.22 AS uv
FROM python:3.13.7-slim-bookworm
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /srv
COPY uv.lock pyproject.toml README.md ./
COPY runtime/pyproject.toml runtime/pyproject.toml
RUN uv export --frozen --all-packages --extra remote --no-dev --no-emit-workspace --format requirements-txt -o /tmp/requirements.txt \
    && uv pip install --system --require-hashes -r /tmp/requirements.txt
COPY runtime/python ./runtime/python
COPY characters ./characters
COPY personas ./personas
COPY worlds ./worlds
COPY prompts ./prompts
COPY LICENSE ./LICENSE
COPY --from=sources /corresponding-source ./source
COPY --from=sources /kyalulu-source.tar.gz ./kyalulu-source.tar.gz
COPY --from=web /src/apps/web/dist ./web
RUN groupadd --gid 10002 kyalulu && useradd --uid 10002 --gid kyalulu kyalulu \
    && mkdir /data /backups && chown kyalulu:kyalulu /data /backups
USER 10002:10002
ENV PYTHONPATH=/srv/runtime PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 KYALULU_WEB_DIST=/srv/web KYALULU_SOURCE_ARCHIVE=/srv/kyalulu-source.tar.gz
CMD ["uvicorn", "python.cloud.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log", "--log-level", "warning"]
