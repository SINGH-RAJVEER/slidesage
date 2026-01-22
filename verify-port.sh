#!/usr/bin/env bash

# Verification script for TypeScript backend port

set -e

echo "🔍 Verifying TypeScript Backend Port"
echo "===================================="
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Verification counters
PASSED=0
FAILED=0

verify_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $1"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC} $1 (MISSING)"
        ((FAILED++))
    fi
}

verify_dir() {
    if [ -d "$1" ]; then
        echo -e "${GREEN}✓${NC} $1/"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC} $1/ (MISSING)"
        ((FAILED++))
    fi
}

echo "📁 Checking Directory Structure..."
echo ""

cd /home/rajveer/Code/projects/slide-sage

# Root files
echo "Root Configuration Files:"
verify_file "backend-ts/package.json"
verify_file "backend-ts/tsconfig.json"
verify_file "backend-ts/drizzle.config.ts"
verify_file "backend-ts/Dockerfile"
verify_file "backend-ts/.env.example"
verify_file "backend-ts/.gitignore"
verify_file "backend-ts/README.md"
echo ""

# Source directories
echo "Source Directories:"
verify_dir "backend-ts/src"
verify_dir "backend-ts/src/db"
verify_dir "backend-ts/src/repositories"
verify_dir "backend-ts/src/services"
verify_dir "backend-ts/src/routes"
verify_dir "backend-ts/src/middleware"
verify_dir "backend-ts/src/utils"
echo ""

# Database layer
echo "Database Layer:"
verify_file "backend-ts/src/db/index.ts"
verify_file "backend-ts/src/db/schema.ts"
verify_file "backend-ts/src/db/migrate.ts"
echo ""

# Repository layer
echo "Repository Layer:"
verify_file "backend-ts/src/repositories/user.repository.ts"
verify_file "backend-ts/src/repositories/presentation.repository.ts"
echo ""

# Service layer
echo "Service Layer:"
verify_file "backend-ts/src/services/auth.service.ts"
verify_file "backend-ts/src/services/presentation.service.ts"
verify_file "backend-ts/src/services/ai.service.ts"
verify_file "backend-ts/src/services/ai-prompts.ts"
echo ""

# Route layer
echo "Route Layer:"
verify_file "backend-ts/src/routes/auth.routes.ts"
verify_file "backend-ts/src/routes/presentation.routes.ts"
echo ""

# Middleware
echo "Middleware:"
verify_file "backend-ts/src/middleware/auth.middleware.ts"
echo ""

# Utils
echo "Utilities:"
verify_file "backend-ts/src/utils/stream-processor.ts"
echo ""

# Main entry
echo "Application Entry:"
verify_file "backend-ts/src/index.ts"
echo ""

# Documentation
echo "Documentation:"
verify_file "MIGRATION_GUIDE.md"
verify_file "QUICKSTART_TS.md"
verify_file "PORT_COMPARISON.md"
verify_file "TYPESCRIPT_PORT_SUMMARY.md"
verify_file "ARCHITECTURE.md"
echo ""

# Deployment
echo "Deployment Configuration:"
verify_file "docker-compose-ts.yml"
verify_file "setup-ts-backend.sh"
echo ""

echo "=================================="
echo "Verification Summary:"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All files verified successfully!${NC}"
    echo ""
    echo "Next Steps:"
    echo "1. cd backend-ts"
    echo "2. bun install"
    echo "3. cp .env.example .env"
    echo "4. Edit .env with your configuration"
    echo "5. bun run db:migrate"
    echo "6. bun run dev"
    exit 0
else
    echo -e "${RED}✗ Verification failed! Some files are missing.${NC}"
    exit 1
fi
