# Svelar Example

A working example SvelteKit app built with the Svelar framework.

## Setup

```bash
# From monorepo root
npm install
npm run build

# Then in this directory
cd packages/svelar-example
npm run dev
```

## What's included

- **User model** with migration (users table)
- **Post model** with migration, controller, and CRUD API routes
- **AuthMiddleware** example (Bearer token check)
- **Health check** endpoint at `/api/health`
- SQLite database (file-based, zero setup)

## Project structure

```
src/
├── app.ts                       # Svelar bootstrap (DB, logging, cache config)
├── hooks.server.ts              # SvelteKit hooks with Svelar middleware
├── lib/
│   ├── models/                  # Eloquent-style models
│   │   ├── User.ts
│   │   └── Post.ts
│   ├── controllers/
│   │   └── PostController.ts    # CRUD with Zod validation
│   ├── middleware/
│   │   └── AuthMiddleware.ts    # Bearer token guard
│   └── database/
│       ├── migrations/          # Schema migrations
│       └── seeders/             # Data seeders
└── routes/
    ├── +page.svelte             # Welcome page
    └── api/health/+server.ts    # Health check
```
