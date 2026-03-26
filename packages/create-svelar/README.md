# create-svelar

Scaffold a new [Svelar](https://github.com/alephtus/svelar) project — Laravel-inspired SvelteKit.

## Usage

```bash
npm create svelar@latest my-app
```

You'll be prompted to choose:

- **Project name** — directory name for your new project
- **Database driver** — SQLite, PostgreSQL, or MySQL
- **Auth scaffolding** — optional pre-built User model, migration, and auth middleware
- **Package manager** — npm, pnpm, or yarn

## What gets generated

```
my-app/
├── src/
│   ├── app.ts                 # Svelar bootstrap (providers, config)
│   ├── hooks.server.ts        # SvelteKit hooks with middleware pipeline
│   ├── models/                # Eloquent-style models
│   ├── controllers/           # Request controllers
│   ├── middleware/             # Custom middleware
│   └── routes/                # SvelteKit routes
├── database/
│   ├── migrations/            # Database migrations
│   └── seeders/               # Database seeders
├── .env                       # Environment variables
├── svelar.config.ts           # Framework configuration
└── package.json
```

## Requirements

- Node.js >= 20

## License

MIT
