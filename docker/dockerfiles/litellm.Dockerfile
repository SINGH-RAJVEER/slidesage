FROM python:3.11-slim

WORKDIR /app

# Used by docker-compose healthcheck
RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl \
	&& rm -rf /var/lib/apt/lists/*

# Install litellm
RUN pip install --no-cache-dir litellm[proxy]

# Expose the default port
EXPOSE 4000

# Run litellm proxy
CMD ["litellm", "--config", "/app/litellm_config.yaml", "--port", "4000", "--host", "0.0.0.0"]
