#!/usr/bin/env bash

# Setup script for TypeScript backend with Bun

set -e

echo "🚀 Setting up SlideSage TypeScript Backend"
echo "========================================="

# Check if Bun is installed
if ! command -v bun &> /dev/null; then
    echo "❌ Bun is not installed. Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
else
    echo "✅ Bun is already installed ($(bun --version))"
fi

# Navigate to backend-ts directory
cd backend-ts

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
bun install

# Check if .env exists
if [ ! -f .env ]; then
    echo ""
    echo "⚙️  Creating .env file from .env.example..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your configuration"
else
    echo "✅ .env file already exists"
fi

# Check if Postgres is running
echo ""
echo "🔍 Checking PostgreSQL connection..."
if docker ps | grep -q slidesage-postgres; then
    echo "✅ PostgreSQL is running"
else
    echo "⚠️  PostgreSQL is not running. Starting with Docker..."
    cd ..
    docker-compose -f docker-compose-ts.yml up -d postgres
    cd backend-ts
    echo "⏳ Waiting for PostgreSQL to be ready..."
    sleep 5
fi

# Run migrations
echo ""
echo "🗄️  Running database migrations..."
bun run db:migrate

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the development server:"
echo "  cd backend-ts"
echo "  bun run dev"
echo ""
echo "To start with Docker:"
echo "  docker-compose -f docker-compose-ts.yml up -d"
echo ""
echo "API will be available at: http://localhost:8000"
echo "Health check: http://localhost:8000/health"
