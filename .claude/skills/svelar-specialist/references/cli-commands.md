# CLI Commands Reference

Full docs: https://svelar.dev/docs/getting-started

## Commands

Confirm the installed command inventory with `npx svelar --help`; release certification derives it from `BuiltinCommands.ts` so new commands cannot silently miss an execution gate.

### Project
| Command | Description | Key Flags |
|---------|-------------|-----------|
| `new <name>` | Create new SvelteKit + Svelar project; use `npx @beeblock/svelar new` outside an installed app | `--validation=zod\|valibot`, `--flat`, `--no-install` |
| `update` | Review scaffold additions; app-owned source is not overwritten by ordinary `--force` | `--force`, `--dry-run`, `--category`, `--list`, `--add-missing-user-files`, `--include-user-files`, `--migrate-zod4`, `--migrate-core` |
| `key:generate` | Generate APP_KEY in .env | `--show`, `--force` |
| `tinker` | Interactive REPL with Svelar preloaded | |

### Code Generators
| Command | Description | Key Flags |
|---------|-------------|-----------|
| `make:model <name>` | Create model class; controller/all generation requires an access decision | `-m` (migration), `-c` (controller), `-r` (resource), `-a` (all), `--module`, `--capability`/`--public`, `--scope`, `--screen-route` |
| `make:entity <name>` | Generate the layered schema/request/DTO/action/model/repository/controller/resource flow | `--crud`, `--fields`, `--module`, `--capability`/`--public`, `--scope`, `--screen-route` |
| `make:dto <name>` | Generate a typed validated payload | `--module`, `--schema`, `--input` |
| `make:migration <name>` | Create migration file | `--create <table>`, `--table <table>` |
| `make:seeder <name>` | Create seeder class | |
| `make:controller <name>` | Create controller class with an explicit access decision | `-r` (resource), `-m` (model), `--module`, `--capability`/`--public`, `--scope`, `--screen-route` |
| `make:route <path>` | Create thin route files with controller and capability guards | `-c`, `-r` (resource), `--api`, `-m` (methods), `--module`, `--capability`/`--public`, `--scope`, `--screen-route`, `--permission` (non-resource routes only) |
| `make:request <name>` | Create FormRequest validation class | `--module` |
| `make:resource <name>` | Create API resource transformer | `--module`, `-m` (model), `-c` (collection) |
| `make:schema <name>` | Create a shared Zod 4 or Valibot schema using `svelar.validation.json` | `--module` |
| `make:service <name>` | Create service class | `--crud`, `-m` (model), `--module` |
| `make:repository <name>` | Create repository class | `-m` (model), `--module` |
| `make:action <name>` | Create action class | `--module` |
| `make:middleware <name>` | Create middleware class | |
| `make:provider <name>` | Create service provider | |
| `make:config <name>` | Create config file | Presets: app, database, auth, mail, cache, queue, storage, broadcasting, logging |
| `make:event <name>` | Create event class | `--module` |
| `make:listener <name>` | Create event listener | `-e` (event), `--module` |
| `make:job <name>` | Create queue job class | |
| `make:task <name>` | Create scheduled task | |
| `make:command <name>` | Create CLI command | `--command` |
| `make:observer <name>` | Create model observer | `-m` (model), `--module` |
| `make:channel <name>` | Create broadcast channel auth | `-p` (presence) |
| `make:broadcasting` | Scaffold broadcasting routes | `--sse`, `--pusher`, `-f` (force) |
| `make:plugin <name>` | Create plugin class | |
| `make:docker` | Scaffold Docker/compose files, app/worker/scheduler services, local dev runtime script, PgBouncer, postgresql.conf, health endpoint | `--db`, `--image`, `--soketi`, `--redis`, `--gotenberg`, `--rustfs`, `--meilisearch`, `-f` |
| `make:ci` | Scaffold GitHub Actions CI/CD workflow | `-f` |
| `make:infra` | Scaffold droplet setup script + env template | `-f` |
| `make:deploy` | Run make:docker + make:ci + make:infra | `--db`, `--image`, `--port`, `--dev-port`, `-f` |
| `make:dashboard` | Scaffold a guarded operational console | `--capability`/`--public`, `--scope`, `--screen-route`, `-f` (force) |
| `make:ui [pattern...]` | Generate app-owned operational shadcn patterns; defaults to all six | `-f` (force); patterns: `select`, `dialog`, `tabs`, `server-table`, `operation-tray`, `capability-editor`, or `all` |

### Testing
| Command | Description | Key Flags |
|---------|-------------|-----------|
| `make:test <name>` | Create test file | `--unit` (default), `--feature`, `--e2e` |
| `make:factory <name>` | Create model factory | `--model`, `--module` |
| `lint:architecture` | Detect thin-route, write-flow, persistence and security convention drift | `--json` |

### Database
| Command | Description | Key Flags |
|---------|-------------|-----------|
| `migrate` | Run pending migrations | `--rollback`, `--reset`, `--refresh`, `--fresh`, `--status`, `--seed`, `--force` |
| `seed:run` | Run database seeders | `--class` |
| `search:setup` | Configure model indexes with Meilisearch | `--help` for installed options |
| `deploy:migrate` | Run forward migrations under exclusive ownership | `--check`, `--connection` |

### Queue
| Command | Description | Key Flags |
|---------|-------------|-----------|
| `queue:work` | Run a configured queue/profile worker, or explicitly run finite work | `--queue`, `--connection`, `--profile`, `--concurrency`, `--lock-duration`, `--stalled-interval`, `--max-stalled-count`, `--grace-period`, `--max-jobs`, `--max-time`, `--sleep`, `--once` |
| `queue:failed` | List failed jobs | |
| `queue:retry <id>` | Retry failed job | `--all` |
| `queue:flush` | Delete all failed job records | |

### Scheduler
| Command | Description | Key Flags |
|---------|-------------|-----------|
| `schedule:run` | Run due work or enqueue run-now | `--once`, `--task`, `--sleep`, `--max-time`, `--grace-period` |
| `schedule:work` | Run the scheduler worker using the registry's persistent/legacy mode | `--once`, `--task`, `--sleep`, `--max-time`, `--grace-period` |
| `schedule:list` | Read shared task status | `--json` |

### Plugins
| Command | Description | Key Flags |
|---------|-------------|-----------|
| `plugin:list` | List discovered plugins | |
| `plugin:publish <name>` | Publish plugin assets | `-f` (force), `--only` (config\|migrations\|assets) |
| `plugin:install <package>` | Install plugin from npm | `--no-publish` |

### Infrastructure
| Command | Description | Key Flags |
|---------|-------------|-----------|
| `infra:setup` | Provision droplet via SSH + copy compose files | `--config`, `--ip`, `--key`, `--deploy-user`, `--project` |

### Docker Compose (Runtime)
| Command | Description | Key Flags |
|---------|-------------|-----------|
| `dev:up` | Start dev containers (hot-reload) | `--service` |
| `dev:down` | Stop dev containers | `--service` |
| `dev:logs` | Follow dev container logs | `--service` |
| `dev:restart` | Restart dev containers (down + up) | `--service` |
| `prod:up` | Start prod containers | `--service` |
| `prod:down` | Stop prod containers | `--service` |
| `prod:logs` | Follow prod container logs | `--service` |
| `prod:restart` | Recreate runtime services without taking dependencies down | `--service` |
| `prod:deploy` | Start-first immutable release promotion with readiness and retained rollback | `--image` (not `latest`), `--rollback`, `--no-pull`, `--no-migrate`, `--compatible-migrations` |

### Routes
| Command | Description | Key Flags |
|---------|-------------|-----------|
| `routes:list` | List all registered routes | `--json`, `--api`, `-m` (method) |

## Module Flag (--module)

Most generators accept `--module <ModuleName>` to place files in a DDD module structure:

```bash
npx svelar make:model Post --module Blog
# Creates: src/lib/modules/Blog/domain/models/Post.ts

npx svelar make:controller PostController --module Blog --capability=posts --scope=team --screen-route=/posts
# Creates: src/lib/modules/Blog/interface/http/controllers/PostController.ts
```

## Access Decisions

Controllers, entities, routes and dashboards require `--capability=<resource>` or an explicitly reviewed `--public` exemption. `make:model --all`/`--controller` forwards that decision. `--scope=team|platform` determines the capability catalog scope; `--screen-route` records the screen's route. `--permission=<canonical capability>` is only for a custom non-resource route, not one broad grant over a CRUD resource. `--public` exempts functional RBAC only; authentication, CSRF, validation and resource policies remain required.

## Common Workflows

### New feature (model + full stack)
```bash
npx svelar make:entity Post --module blog --fields "title:string,body:text,published:boolean" --crud --capability=posts --scope=team --screen-route=/posts
# Creates: model, schema, DTOs, FormRequests, actions, resource, repository, service, controller, migration
```

### CRUD API endpoint
```bash
npx svelar make:model Product -a --capability=products --scope=team --screen-route=/products
npx svelar make:request CreateProductRequest
npx svelar make:request UpdateProductRequest
npx svelar make:route api/products --resource --controller ProductController --capability=products --scope=team --screen-route=/products
npx svelar migrate
```

### Background processing
```bash
npx svelar make:job ProcessOrder
npx svelar make:task CleanupOldOrders
npx svelar queue:work --profile=notifications --max-time=3600 --grace-period=30
npx svelar schedule:work --sleep=1000 --max-time=3600 --grace-period=30
npx svelar schedule:run --task=cleanup-old-orders
npx svelar schedule:list --json
```

Worker profiles must be registered in application configuration; names are not built-in presets. `schedule:run --task` requires a persistent scheduler registry and enqueues a durable request, not inline execution. Scheduler `--grace-period` warns while draining; it never releases healthy leases before the handler and hooks finish. Scheduler scope/timezone comes from its registry, not a `--profile` flag or ambient HTTP tenant.

### Optional UI patterns
```bash
npm run ui:install
npx svelar make:ui select,dialog
npx svelar make:ui server-table operation-tray capability-editor
npx svelar make:ui all
```

The installer retains all shadcn primitives. Patterns use `$lib/shared/components/patterns` in DDD apps and `$lib/components/patterns` in flat apps, alongside shared `contracts.ts`/`helpers.ts`. No routes, backend writes or demo data are generated. Existing app-owned components are preserved without `--force`; customized shared contracts/helpers require review before forced replacement. UI visibility is not authorization: keep capability checks and shared FormRequest/DTO validation on every server write.

### Testing setup
```bash
npx svelar make:factory User --model User
npx svelar make:factory Post --model Post
npx svelar make:test PostService --unit
npx svelar make:test Auth --feature
npx svelar make:test Login --e2e
npm test
```

### Fresh database reset
```bash
npx svelar migrate --fresh --seed
```
