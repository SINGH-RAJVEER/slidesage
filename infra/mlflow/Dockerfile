FROM ghcr.io/astral-sh/uv:0.12.11 AS uv

FROM docker.io/library/python:3.12.12-slim

ENV PATH="/app/.venv/bin:$PATH" \
	UV_COMPILE_BYTECODE=1 \
	UV_LINK_MODE=copy

WORKDIR /app

COPY --from=uv /uv /uvx /bin/
COPY infra/mlflow/pyproject.toml infra/mlflow/uv.lock ./
COPY infra/mlflow/entrypoint.sh /app/entrypoint.sh

RUN uv sync --frozen --no-dev \
	&& chmod 0555 /app/entrypoint.sh

EXPOSE 5000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["--host", "0.0.0.0", "--port", "5000"]
