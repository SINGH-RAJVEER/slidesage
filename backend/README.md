# TypeScript Backend (Bun + Hono + Drizzle)

## Setup

1. Install dependencies:

```bash
bun install
```

2. Set up environment variables:

```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Run database migrations:

```bash
bun run db:migrate
```

4. Start development server:

```bash
bun run dev
```

## Scripts

- `bun run dev` - Start development server with hot reload
- `bun run start` - Start production server
- `bun run db:generate` - Generate Drizzle migrations
- `bun run db:push` - Push schema changes to database
- `bun run db:migrate` - Run database migrations
- `bun run db:studio` - Open Drizzle Studio (database GUI)
- `bun run lint` - Lint code with Biome
- `bun run lint:fix` - Lint and auto-fix issues
- `bun run format` - Format code with Biome

## API Endpoints

### Authentication

- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/google` - Google OAuth login
- `POST /api/auth/refresh` - Refresh access token
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/profile` - Update user profile
- `POST /api/auth/logout` - Logout user

### Presentations

- `POST /api/generate-presentation-stream` - Generate presentation (SSE stream)
- `GET /api/presentations` - Get all user presentations
- `GET /api/presentations/:id` - Get specific presentation
- `DELETE /api/presentations/:id` - Delete presentation

## Database

Using Bun's built-in PostgreSQL support with Drizzle ORM.

To view the database:

```bash
bun run db:studio
```
