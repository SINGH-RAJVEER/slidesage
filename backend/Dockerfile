FROM python:3.11-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy dependency files
COPY requirements.txt .

# Install dependencies using uv
RUN uv pip install --system --no-cache -r requirements.txt

# Copy backend sources
COPY . /app

# Expose Flask port
EXPOSE 8000

# Set environment variables
ENV FLASK_APP=main
ENV FLASK_ENV=production

# Run Flask
CMD ["flask", "run", "--host=0.0.0.0", "--port=8000"]
