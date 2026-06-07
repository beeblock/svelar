# CLI Commands Reference

Full docs: https://svelar.dev/docs/getting-started

## All Commands (54)

### Project
| Command | Description | Key Flags |
|---------|-------------|-----------|
| `new <name>` | Create new SvelteKit + Svelar project | `--flat`, `--no-install` |
| `update` | Update scaffold files from latest templates | `--force`, `--dry-run`, `--category`, `--list` |
| `key:generate` | Generate APP_KEY in .env | `--show`, `--force` |
| `tinker` | Interactive REPL with Svelar preloaded | |

### Code Generators
| Command | Description | Key Flags |
|---------|-------------|-----------|
| `make:model <name>` | Create model class | `-m` (migration), `-c` (controller), `-r` (resource), `-a` (all), `--module` |
| `make:migration <name>` | Create migration file | `--create <table>`, `--table <table>` |
| `make:seeder <name>` | Create seeder class | |
| `make:controller <name>` | Create controller class | `-r` (resource), `-m` (model), `--module` |
| `make:route <path>` | Create route files with controller | `-c`, `-r` (resource), `--api`, `-m` (methods), `--module` |
| `make:request <name>` | Create FormRequest validation class | `--module` |
| `make:resource <name>` | Create API resource transformer | `--module`, `-m` (model), `-c` (collection) |
| `make:schema <name>` | Create Zod schema contract | `--module` |
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
| `make:dashboard` | Scaffold admin dashboard | |

### Testing
| Command | Description | Key Flags |
|---------|-------------|-----------|
| `make:test <name>` | Create test file | `--unit` (default), `--feature`, `--e2e` |
| `make:factory <name>` | Create model factory | `--model` |

### Database
| Command | Description | Key Flags |
|---------|-------------|-----------|
| `migrate` | Run pending migrations | `--rollback`, `--reset`, `--refresh`, `--fresh`, `--status`, `--seed`, `--force` |
| `seed:run` | Run database seeders | `--class` |

### Queue
| Command | Description | Key Flags |
|---------|-------------|-----------|
| `queue:work` | Process queued jobs | `--queue`, `--max-jobs`, `--max-time`, `--sleep`, `--once` |
| `queue:failed` | List failed jobs | |
| `queue:retry <id>` | Retry failed job | `--all` |
| `queue:flush` | Delete all failed job records | |

### Scheduler
| Command | Description | Key Flags |
|---------|-------------|-----------|
| `schedule:run` | Run the task scheduler | `--once` |

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
| `prod:restart` | Restart prod containers (down + up) | `--service` |
| `prod:deploy` | Pull latest images + restart prod | `--service` |

### Routes
| Command | Description | Key Flags |
|---------|-------------|-----------|
| `routes:list` | List all registered routes | `--json`, `--api`, `-m` (method) |

## Module Flag (--module)

Most generators accept `--module <ModuleName>` to place files in a DDD module structure:

```bash
npx svelar make:model Post --module Blog
# Creates: src/lib/modules/Blog/domain/models/Post.ts

npx svelar make:controller PostController --module Blog
# Creates: src/lib/modules/Blog/interface/http/controllers/PostController.ts
```

## Common Workflows

### New feature (model + full stack)
```bash
npx svelar make:entity Post --module blog --fields "title:string,body:text,published:boolean" --crud
# Creates: model, schema, DTOs, FormRequests, actions, resource, repository, service, controller, migration
```

### CRUD API endpoint
```bash
npx svelar make:model Product -a
npx svelar make:request CreateProductRequest
npx svelar make:request UpdateProductRequest
npx svelar make:route api/products --resource --controller ProductController
npx svelar migrate
```

### Background processing
```bash
npx svelar make:job ProcessOrder
npx svelar make:task CleanupOldOrders
```

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
