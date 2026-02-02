FROM python:3.11-slim

WORKDIR /app

# Install litellm
RUN pip install --no-cache-dir litellm[proxy]

# Expose the default port
EXPOSE 4000

# Run litellm proxy
CMD ["litellm", "--config", "/app/litellm_config.yaml", "--port", "4000", "--host", "0.0.0.0"]
