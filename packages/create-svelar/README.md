# create-svelar

Scaffold a new [Svelar](https://svelar.dev) project — Laravel-inspired SvelteKit.

## Usage

```bash
npm create svelar@latest my-app
```

You'll be prompted to choose:

- **Project name** — directory name for your new project
- **Database driver** — SQLite, PostgreSQL, or MySQL
- **Package manager** — npm, pnpm, or yarn

Auth scaffolding (login, register, password reset, dashboard, admin panel) is included by default.

## What gets generated

```
my-app/
├── src/
│   ├── app.ts                 # Svelar bootstrap (database, auth, queue, etc.)
│   ├── hooks.server.ts        # Middleware pipeline (createSvelarApp)
│   ├── lib/
│   │   ├── models/            # Eloquent-style models
│   │   ├── controllers/       # Request controllers
│   │   ├── services/          # Business logic
│   │   ├── dtos/              # FormRequest validation
│   │   ├── schemas/           # Zod contract schemas
│   │   ├── shared/            # Jobs, scheduler, middleware, providers
│   │   └── database/          # Migrations and seeders
│   └── routes/                # SvelteKit routes (auth, dashboard, admin, API)
├── .env                       # Auto-generated with secure random secrets
├── svelar.database.json       # Database configuration
└── package.json
```

## Requirements

- Node.js >= 20

## License

MIT
