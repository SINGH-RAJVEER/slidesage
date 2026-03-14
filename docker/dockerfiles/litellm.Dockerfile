# syntax=docker/dockerfile:1.7

FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl \
	&& rm -rf /var/lib/apt/lists/*

RUN --mount=type=cache,target=/root/.cache/pip \
	pip install --no-cache-dir "litellm[proxy]" "litellm[google]"

COPY litellm_config.yaml /app/litellm_config.yaml

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD curl -fsS http://localhost:4000/health || exit 1

CMD ["litellm", "--config", "/app/litellm_config.yaml", "--port", "4000", "--host", "0.0.0.0"]
