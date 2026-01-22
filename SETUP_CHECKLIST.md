# ✅ TypeScript Backend Setup Checklist

Use this checklist to get your new TypeScript backend up and running!

---

## Prerequisites

- [ ] Bun installed (or run `curl -fsSL https://bun.sh/install | bash`)
- [ ] PostgreSQL running (or use Docker)
- [ ] Environment variables ready (API keys, etc.)

---

## Setup Steps

### 1. Install Dependencies

- [ ] Navigate to backend-ts: `cd backend-ts`
- [ ] Run: `bun install`
- [ ] Wait for dependencies to install

### 2. Configure Environment

- [ ] Copy template: `cp .env.example .env`
- [ ] Edit `.env` file
- [ ] Set `DATABASE_URL`
- [ ] Set `JWT_SECRET_KEY`
- [ ] Set `GOOGLE_CLIENT_ID` (if using OAuth)
- [ ] Set `GOOGLE_CLIENT_SECRET` (if using OAuth)
- [ ] Set `OPENAI_API_KEY` or `LITELLM_MODEL`
- [ ] Set `CORS_ORIGINS` (e.g., `http://localhost:5173`)

### 3. Database Setup

- [ ] Ensure PostgreSQL is running
  - Docker: `docker-compose -f docker-compose-ts.yml up -d postgres`
  - Or: Local PostgreSQL on port 5432
- [ ] Run migrations: `bun run db:migrate`
- [ ] Verify connection (no errors)

### 4. Start Development Server

- [ ] Run: `bun run dev`
- [ ] Server starts on port 8000
- [ ] No errors in console
- [ ] Hot reload is working

### 5. Test the API

- [ ] Health check: `curl http://localhost:8000/health`
  - Response: `{"status":"ok","timestamp":"..."}`
- [ ] Register a user:
  ```bash
  curl -X POST http://localhost:8000/api/auth/register \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","name":"Test","password":"pass123"}'
  ```
- [ ] Receive access_token in response
- [ ] Login works
- [ ] Protected endpoints require token

---

## Frontend Integration

### 6. Update Frontend (if needed)

- [ ] Check frontend API_BASE_URL
- [ ] Should point to: `http://localhost:8000/api`
- [ ] Test frontend → backend connection
- [ ] Login flow works
- [ ] Presentation generation works
- [ ] Streaming updates display correctly

---

## Docker Deployment (Optional)

### 7. Docker Setup

- [ ] Build images: `docker-compose -f docker-compose-ts.yml build`
- [ ] Start services: `docker-compose -f docker-compose-ts.yml up -d`
- [ ] Check logs: `docker-compose -f docker-compose-ts.yml logs -f backend`
- [ ] Verify health: `curl http://localhost:8000/health`

---

## Database Management

### 8. Database Tools

- [ ] Open Drizzle Studio: `bun run db:studio`
- [ ] Access at: `https://local.drizzle.studio`
- [ ] Inspect users table
- [ ] Inspect presentations table
- [ ] Verify indexes exist

---

## Verification

### 9. Feature Testing

- [ ] User registration works
- [ ] User login works
- [ ] Google OAuth works (if configured)
- [ ] Token refresh works
- [ ] Profile updates work
- [ ] Presentation generation works
- [ ] SSE streaming works
- [ ] Presentation listing works
- [ ] Presentation retrieval works
- [ ] Presentation deletion works
- [ ] Daily login bonus works
- [ ] Token deduction works

### 10. Performance Check

- [ ] Server starts quickly (< 1 second)
- [ ] Response times are fast (< 50ms)
- [ ] Memory usage is reasonable (< 50MB)
- [ ] No memory leaks
- [ ] CPU usage is low

---

## Documentation Review

### 11. Read Documentation

- [ ] Read [START_HERE.md](./START_HERE.md) - Overview
- [ ] Read [QUICKSTART_TS.md](./QUICKSTART_TS.md) - Quick start
- [ ] Skim [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) - Details
- [ ] Review [ARCHITECTURE.md](./ARCHITECTURE.md) - Architecture
- [ ] Check [PORT_COMPLETE.md](./PORT_COMPLETE.md) - Completion report

---

## Optional Enhancements

### 12. Additional Setup

- [ ] Set up SSL/TLS for production
- [ ] Configure reverse proxy (nginx)
- [ ] Set up monitoring (logs, metrics)
- [ ] Configure backups for database
- [ ] Set up CI/CD pipeline
- [ ] Add rate limiting
- [ ] Add caching layer
- [ ] Configure log rotation

---

## Troubleshooting

### Common Issues

- [ ] If port 8000 is in use, change `PORT` in `.env`
- [ ] If DB connection fails, check `DATABASE_URL`
- [ ] If API key errors, verify `.env` configuration
- [ ] If type errors, run `bun install` again
- [ ] If hot reload doesn't work, restart `bun run dev`

---

## Final Checks

### 13. Production Readiness

- [ ] All tests pass (manual testing done)
- [ ] No console errors
- [ ] Environment variables secured
- [ ] Database migrations run successfully
- [ ] Docker deployment tested
- [ ] Documentation is complete
- [ ] Frontend works with backend
- [ ] Performance is acceptable
- [ ] Security measures in place

---

## 🎉 Completion

When all checkboxes are marked:

- ✅ Your TypeScript backend is fully operational!
- ✅ You can now develop with hot reload
- ✅ You can deploy to production
- ✅ You have full type safety
- ✅ You're running 3x faster than Flask!

---

## Quick Reference

### Commands

```bash
# Development
bun run dev              # Start dev server
bun run db:studio        # Open DB GUI

# Database
bun run db:migrate       # Run migrations
bun run db:generate      # Generate migrations
bun run db:push          # Push schema

# Production
bun run start            # Start production
docker-compose -f docker-compose-ts.yml up -d  # Docker
```

### File Locations

- Config: `backend-ts/.env`
- Schema: `backend-ts/src/db/schema.ts`
- Routes: `backend-ts/src/routes/`
- Services: `backend-ts/src/services/`

---

## Next Steps After Setup

1. **Develop Features**: Add new endpoints, modify existing ones
2. **Test Thoroughly**: Ensure everything works as expected
3. **Deploy**: Use Docker for production deployment
4. **Monitor**: Set up logging and monitoring
5. **Optimize**: Profile and optimize as needed

---

## 📞 Get Help

If you're stuck:

1. Check the error message carefully
2. Review the relevant documentation file
3. Check `docker-compose logs backend` for logs
4. Verify your `.env` configuration
5. Try the verification script: `./verify-port.sh`

---

**Happy coding with TypeScript!** 🚀
