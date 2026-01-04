# SlideSage Development Makefile

.PHONY: help dev dev-backend dev-frontend install install-backend install-frontend test lint clean docker-up docker-down

help:
	@echo "SlideSage Development Commands"
	@echo "=============================="
	@echo "make dev              - Start full development environment"
	@echo "make dev-backend      - Start backend development server"
	@echo "make dev-frontend     - Start frontend development server"
	@echo "make install          - Install all dependencies"
	@echo "make install-backend  - Install backend dependencies"
	@echo "make install-frontend - Install frontend dependencies"
	@echo "make test             - Run all tests"
	@echo "make test-backend     - Run backend tests"
	@echo "make lint             - Run linters on all code"
	@echo "make lint-backend     - Run backend linter"
	@echo "make lint-frontend    - Run frontend linter"
	@echo "make docker-up        - Start Docker services"
	@echo "make docker-down      - Stop Docker services"
	@echo "make clean            - Clean build artifacts"

dev:
	docker-compose up

dev-backend:
	cd backend && python main.py

dev-frontend:
	cd frontend && bun run dev

install: install-backend install-frontend

install-backend:
	cd backend && pip install -r requirements.txt

install-frontend:
	cd frontend && bun install

test: test-backend

test-backend:
	cd backend && pytest

lint: lint-backend lint-frontend

lint-backend:
	cd backend && ruff check .

lint-frontend:
	cd frontend && bun run lint

docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	find . -type d -name ".pytest_cache" -exec rm -rf {} +
	find . -type d -name "node_modules" -exec rm -rf {} +
	find . -type d -name "dist" -exec rm -rf {} +
