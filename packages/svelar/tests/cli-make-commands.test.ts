import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Import all make commands
import { MakeModelCommand } from '../src/cli/commands/MakeModelCommand.js';
import { MakeControllerCommand } from '../src/cli/commands/MakeControllerCommand.js';
import { MakeServiceCommand } from '../src/cli/commands/MakeServiceCommand.js';
import { MakeJobCommand } from '../src/cli/commands/MakeJobCommand.js';
import { MakeTaskCommand } from '../src/cli/commands/MakeTaskCommand.js';
import { MakeMiddlewareCommand } from '../src/cli/commands/MakeMiddlewareCommand.js';
import { MakeRepositoryCommand } from '../src/cli/commands/MakeRepositoryCommand.js';
import { MakeResourceCommand } from '../src/cli/commands/MakeResourceCommand.js';
import { MakeRequestCommand } from '../src/cli/commands/MakeRequestCommand.js';
import { MakeActionCommand } from '../src/cli/commands/MakeActionCommand.js';
import { MakeObserverCommand } from '../src/cli/commands/MakeObserverCommand.js';
import { MakeSchemaCommand } from '../src/cli/commands/MakeSchemaCommand.js';
import { MakeEntityCommand } from '../src/cli/commands/MakeEntityCommand.js';
import { MakeEventCommand } from '../src/cli/commands/MakeEventCommand.js';
import { MakeListenerCommand } from '../src/cli/commands/MakeListenerCommand.js';
import { MakeChannelCommand } from '../src/cli/commands/MakeChannelCommand.js';
import { MakeCommandCommand } from '../src/cli/commands/MakeCommandCommand.js';
import { MakeProviderCommand } from '../src/cli/commands/MakeProviderCommand.js';
import { MakePluginCommand } from '../src/cli/commands/MakePluginCommand.js';
import { MakeFactoryCommand } from '../src/cli/commands/MakeFactoryCommand.js';
import { MakeDeployCommand } from '../src/cli/commands/MakeDeployCommand.js';
import { MakeDockerCommand } from '../src/cli/commands/MakeDockerCommand.js';
import { MakeDashboardCommand } from '../src/cli/commands/MakeDashboardCommand.js';
import { MakeRouteCommand } from '../src/cli/commands/MakeRouteCommand.js';
import { MakeMigrationCommand } from '../src/cli/commands/MakeMigrationCommand.js';
import { NewCommandTemplates } from '../src/cli/commands/NewCommandTemplates.js';

let originalCwd: string;
let tmpDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  originalCwd = process.cwd();
  tmpDir = join(originalCwd, '.test-make-cmds-' + Date.now());
  mkdirSync(tmpDir, { recursive: true });
  process.chdir(tmpDir);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

// ── Flat structure tests ──────────────────────────────────

describe('Make commands — Flat structure', () => {
  describe('MakeJobCommand', () => {
    it('should have correct name and description', () => {
      const cmd = new MakeJobCommand();
      expect(cmd.name).toBe('make:job');
      expect(cmd.description).toBeDefined();
    });

    it('should create job file in src/lib/jobs/', async () => {
      const cmd = new MakeJobCommand();
      await cmd.handle(['SendEmail'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'jobs', 'SendEmail.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('class SendEmail extends Job');
      expect(content).toContain("import { Job } from '@beeblock/svelar/queue'");
    });

    it('should error without name', async () => {
      const cmd = new MakeJobCommand();
      await cmd.handle([], {});
      expect(errorSpy).toHaveBeenCalled();
    });

    it('should warn if file already exists', async () => {
      const cmd = new MakeJobCommand();
      await cmd.handle(['SendEmail'], {});
      await cmd.handle(['SendEmail'], {});
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    });
  });

  describe('MakeTaskCommand', () => {
    it('should create task file in src/lib/scheduler/', async () => {
      const cmd = new MakeTaskCommand();
      await cmd.handle(['CleanupTokens'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'scheduler', 'CleanupTokens.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('export default class CleanupTokens extends ScheduledTask');
    });
  });

  describe('MakeMiddlewareCommand', () => {
    it('should create middleware file in src/lib/middleware/', async () => {
      const cmd = new MakeMiddlewareCommand();
      await cmd.handle(['AuthMiddleware'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'middleware', 'AuthMiddleware.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('class AuthMiddleware extends Middleware');
    });
  });

  describe('MakeChannelCommand', () => {
    it('should create channel file with Channel suffix', async () => {
      const cmd = new MakeChannelCommand();
      await cmd.handle(['Order'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'channels', 'OrderChannel.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('registerOrderChannel');
      expect(content).toContain('return false;');
      expect(content).not.toContain('TODO');
      expect(content).not.toContain('return !!user');
    });
  });

  describe('MakeCommandCommand', () => {
    it('should create command file with Command suffix', async () => {
      const cmd = new MakeCommandCommand();
      await cmd.handle(['SyncUsers'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'commands', 'SyncUsersCommand.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('class SyncUsersCommand extends Command');
      expect(content).toContain("description = 'Run Sync Users'");
      expect(content).toContain("name: 'dry-run'");
      expect(content).not.toContain('TODO');
    });
  });

  describe('MakeProviderCommand', () => {
    it('should create provider file', async () => {
      const cmd = new MakeProviderCommand();
      await cmd.handle(['AppServiceProvider'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'providers', 'AppServiceProvider.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('class AppServiceProvider extends ServiceProvider');
    });
  });

  describe('MakePluginCommand', () => {
    it('should create plugin file', async () => {
      const cmd = new MakePluginCommand();
      await cmd.handle(['AnalyticsPlugin'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'plugins', 'AnalyticsPlugin.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('class AnalyticsPlugin extends Plugin');
    });
  });

  describe('MakeModelCommand', () => {
    it('should create model file in src/lib/models/', async () => {
      const cmd = new MakeModelCommand();
      await cmd.handle(['Post'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'models', 'Post.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('class Post extends Model');
    });

    it('should error without name', async () => {
      const cmd = new MakeModelCommand();
      await cmd.handle([], {});
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('MakeMigrationCommand', () => {
    it('should create a table migration from a PascalCase Laravel-style name', async () => {
      const cmd = new MakeMigrationCommand();
      await cmd.handle(['CreateInvoicesTable'], {});

      const migrationsDir = join(tmpDir, 'src', 'lib', 'database', 'migrations');
      const created = readdirSync(migrationsDir).find((file) => file.endsWith('_create_invoices_table.ts'));
      expect(created).toBeDefined();

      const content = readFileSync(join(migrationsDir, created!), 'utf-8');
      expect(content).toContain('export default class CreateInvoicesTable extends Migration');
      expect(content).toContain("await this.schema.createTable('invoices'");
      expect(content).not.toContain('// Write your migration here');
    });

    it('should create an alter migration using schema.table', async () => {
      const cmd = new MakeMigrationCommand();
      await cmd.handle(['AddRoleToUsers'], {});

      const migrationsDir = join(tmpDir, 'src', 'lib', 'database', 'migrations');
      const created = readdirSync(migrationsDir).find((file) => file.endsWith('_add_role_to_users.ts'));
      expect(created).toBeDefined();

      const content = readFileSync(join(migrationsDir, created!), 'utf-8');
      expect(content).toContain('export default class AddRoleToUsers extends Migration');
      expect(content).toContain("await this.schema.table('users'");
      expect(content).toContain("table.dropColumn('new_column')");
      expect(content).not.toContain('this.schema.addColumn');
    });
  });

  describe('MakeControllerCommand', () => {
    it('should create controller file in src/lib/controllers/', async () => {
      const cmd = new MakeControllerCommand();
      await cmd.handle(['PostController'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'controllers', 'PostController.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('class PostController extends Controller');
    });
  });

  describe('MakeServiceCommand', () => {
    it('should create service file in src/lib/services/', async () => {
      const cmd = new MakeServiceCommand();
      await cmd.handle(['PostService'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'services', 'PostService.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('class PostService');
    });
  });

  describe('MakeRepositoryCommand', () => {
    it('should create repository file in src/lib/repositories/', async () => {
      const cmd = new MakeRepositoryCommand();
      await cmd.handle(['PostRepository'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'repositories', 'PostRepository.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('class PostRepository');
    });
  });

  describe('MakeResourceCommand', () => {
    it('should create resource file in src/lib/resources/', async () => {
      const cmd = new MakeResourceCommand();
      await cmd.handle(['PostResource'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'resources', 'PostResource.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('class PostResource extends Resource');
    });
  });

  describe('MakeRequestCommand', () => {
    it('should create request file in src/lib/dtos/', async () => {
      const cmd = new MakeRequestCommand();
      await cmd.handle(['CreatePostRequest'], {});
      // module auto-derived from basename: "CreatePost" -> "createpost"
      const filePath = join(tmpDir, 'src', 'lib', 'dtos', 'CreatePostRequest.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('class CreatePostRequest extends FormRequest');
    });

    it('should create Valibot request stubs when configured', async () => {
      writeFileSync(join(tmpDir, 'svelar.validation.json'), JSON.stringify({ validation: 'valibot' }));

      const cmd = new MakeRequestCommand();
      await cmd.handle(['CreatePostRequest'], {});

      const filePath = join(tmpDir, 'src', 'lib', 'dtos', 'CreatePostRequest.ts');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain("import * as v from 'valibot'");
      expect(content).toContain('v.object({');
      expect(content).not.toContain('@beeblock/svelar/validation');
    });
  });

  describe('MakeActionCommand', () => {
    it('should create action file with Action suffix', async () => {
      const cmd = new MakeActionCommand();
      await cmd.handle(['CreatePost'], {});
      // "CreatePost" -> auto-derived module "createpost", appends "Action"
      const filePath = join(tmpDir, 'src', 'lib', 'actions', 'CreatePostAction.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('class CreatePostAction');
      expect(content).toContain('async execute(input: CreatePostActionInput)');
      expect(content).not.toContain('async handle(input');
    });

    it('should create Valibot schema stubs from make:action --schema when configured', async () => {
      writeFileSync(join(tmpDir, 'svelar.validation.json'), JSON.stringify({ validation: 'valibot' }));

      const cmd = new MakeActionCommand();
      await cmd.handle(['CreatePost'], { schema: true });

      const filePath = join(tmpDir, 'src', 'lib', 'schemas', 'create-post.schema.ts');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain("import * as v from 'valibot'");
      expect(content).toContain('v.InferOutput');
      expect(content).not.toContain('z.infer');
    });
  });

  describe('MakeObserverCommand', () => {
    it('should create observer file in src/lib/observers/', async () => {
      const cmd = new MakeObserverCommand();
      await cmd.handle(['PostObserver'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'observers', 'PostObserver.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('class PostObserver');
    });
  });

  describe('MakeSchemaCommand', () => {
    it('should create schema file', async () => {
      const cmd = new MakeSchemaCommand();
      await cmd.handle(['Post'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'schemas', 'post.schema.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('zod');
    });

    it('should create Valibot schema files when configured', async () => {
      writeFileSync(join(tmpDir, 'svelar.validation.json'), JSON.stringify({ validation: 'valibot' }));

      const cmd = new MakeSchemaCommand();
      await cmd.handle(['Post'], {});

      const filePath = join(tmpDir, 'src', 'lib', 'schemas', 'post.schema.ts');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain("import * as v from 'valibot'");
      expect(content).toContain('v.partial(createPostSchema)');
      expect(content).toContain('v.InferOutput');
      expect(content).not.toContain("import { z }");
    });
  });

  describe('MakeEntityCommand', () => {
    it('should create Valibot entity schemas when configured', async () => {
      writeFileSync(join(tmpDir, 'svelar.validation.json'), JSON.stringify({ validation: 'valibot' }));

      const cmd = new MakeEntityCommand();
      await cmd.handle(['Task'], { fields: 'title:string,done:boolean,status:enum(todo,doing,done)', crud: true, 'no-migration': true });

      const filePath = join(tmpDir, 'src', 'lib', 'schemas', 'task.schema.ts');
      const content = readFileSync(filePath, 'utf-8');
      const requestPath = join(tmpDir, 'src', 'lib', 'dtos', 'TaskRequests.ts');
      const requestContent = readFileSync(requestPath, 'utf-8');
      expect(content).toContain("import * as v from 'valibot'");
      expect(content).toContain('const booleanInput');
      expect(content).toContain("status: v.picklist(['todo', 'doing', 'done'])");
      expect(content).toContain('export const updateTaskSchema = v.partial(createTaskSchema)');
      expect(content).not.toContain('@beeblock/svelar/validation');
      expect(requestContent).toContain("import * as v from 'valibot'");
      expect(requestContent).toContain('v.intersect([updateTaskSchema, v.object({ id: idSchema })])');
      expect(requestContent).not.toContain('@beeblock/svelar/validation');
    });
  });

  describe('MakeEventCommand', () => {
    it('should create event file in src/lib/events/', async () => {
      const cmd = new MakeEventCommand();
      await cmd.handle(['PostCreated'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'events', 'PostCreated.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('class PostCreated');
    });
  });

  describe('MakeListenerCommand', () => {
    it('should create listener file in src/lib/listeners/', async () => {
      const cmd = new MakeListenerCommand();
      await cmd.handle(['SendWelcomeEmail'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'listeners', 'SendWelcomeEmail.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('class SendWelcomeEmail');
    });
  });
});

// ── DDD structure tests ──────────────────────────────────

describe('Make commands — DDD structure', () => {
  beforeEach(() => {
    mkdirSync(join(tmpDir, 'src', 'lib', 'modules'), { recursive: true });
  });

  describe('MakeJobCommand (DDD)', () => {
    it('should create job in src/lib/shared/jobs/', async () => {
      const cmd = new MakeJobCommand();
      await cmd.handle(['SendEmail'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'shared', 'jobs', 'SendEmail.ts');
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('MakeTaskCommand (DDD)', () => {
    it('should create task in src/lib/shared/scheduler/', async () => {
      const cmd = new MakeTaskCommand();
      await cmd.handle(['CleanupTokens'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'shared', 'scheduler', 'CleanupTokens.ts');
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('MakeMiddlewareCommand (DDD)', () => {
    it('should create middleware in src/lib/shared/middleware/', async () => {
      const cmd = new MakeMiddlewareCommand();
      await cmd.handle(['AuthMiddleware'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'shared', 'middleware', 'AuthMiddleware.ts');
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('MakeModelCommand (DDD)', () => {
    it('should create model in the module domain layer', async () => {
      const cmd = new MakeModelCommand();
      await cmd.handle(['Post'], { module: 'blog' });
      const filePath = join(tmpDir, 'src', 'lib', 'modules', 'blog', 'domain', 'models', 'Post.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('class Post extends Model');
    });
  });

  describe('MakeControllerCommand (DDD)', () => {
    it('should create controller in the module HTTP interface layer', async () => {
      const cmd = new MakeControllerCommand();
      await cmd.handle(['PostController'], { module: 'blog' });
      const filePath = join(tmpDir, 'src', 'lib', 'modules', 'blog', 'interface', 'http', 'controllers', 'PostController.ts');
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('MakeServiceCommand (DDD)', () => {
    it('should create service in the module application layer', async () => {
      const cmd = new MakeServiceCommand();
      await cmd.handle(['PostService'], { module: 'blog' });
      const filePath = join(tmpDir, 'src', 'lib', 'modules', 'blog', 'application', 'services', 'PostService.ts');
      expect(existsSync(filePath)).toBe(true);
    });

    it('should create a CRUD service using the module model when no --model is provided', async () => {
      const modelDir = join(tmpDir, 'src', 'lib', 'modules', 'billing', 'domain', 'models');
      mkdirSync(modelDir, { recursive: true });
      writeFileSync(join(modelDir, 'Invoice.ts'), `import { Model } from '@beeblock/svelar/orm';

export class Invoice extends Model {}
`);

      const cmd = new MakeServiceCommand();
      await cmd.handle(['Billing'], { module: 'billing', crud: true });

      const filePath = join(tmpDir, 'src', 'lib', 'modules', 'billing', 'application', 'services', 'BillingService.ts');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain("import { Invoice } from '$lib/modules/billing/domain/models/Invoice.js';");
      expect(content).toContain('extends CrudService<Invoice>');
      expect(content).toContain('protected repository(): Repository<Invoice>');
      expect(content).not.toContain('./Model.js');
    });
  });

  describe('MakeEventCommand (DDD)', () => {
    it('should create event in the module domain layer', async () => {
      const cmd = new MakeEventCommand();
      await cmd.handle(['PostCreated'], { module: 'blog' });
      const filePath = join(tmpDir, 'src', 'lib', 'modules', 'blog', 'domain', 'events', 'PostCreated.ts');
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('MakeChannelCommand (DDD)', () => {
    it('should create channel in src/lib/shared/channels/', async () => {
      const cmd = new MakeChannelCommand();
      await cmd.handle(['Order'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'shared', 'channels', 'OrderChannel.ts');
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('MakeProviderCommand (DDD)', () => {
    it('should create provider in src/lib/shared/providers/', async () => {
      const cmd = new MakeProviderCommand();
      await cmd.handle(['AppServiceProvider'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'shared', 'providers', 'AppServiceProvider.ts');
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('MakePluginCommand (DDD)', () => {
    it('should create plugin in src/lib/shared/plugins/', async () => {
      const cmd = new MakePluginCommand();
      await cmd.handle(['AnalyticsPlugin'], {});
      const filePath = join(tmpDir, 'src', 'lib', 'shared', 'plugins', 'AnalyticsPlugin.ts');
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('MakeFactoryCommand (DDD)', () => {
    it('should use an explicit module for model imports', async () => {
      const cmd = new MakeFactoryCommand();
      await cmd.handle(['Invoice'], { model: 'Invoice', module: 'billing' });

      const filePath = join(tmpDir, 'src', 'lib', 'factories', 'InvoiceFactory.ts');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain("import { Invoice } from '$lib/modules/billing/Invoice';");
    });

    it('should detect the module that contains the model', async () => {
      const modelDir = join(tmpDir, 'src', 'lib', 'modules', 'billing');
      mkdirSync(modelDir, { recursive: true });
      writeFileSync(join(modelDir, 'Invoice.ts'), 'export class Invoice {}');

      const cmd = new MakeFactoryCommand();
      await cmd.handle(['Invoice'], { model: 'Invoice' });

      const filePath = join(tmpDir, 'src', 'lib', 'factories', 'InvoiceFactory.ts');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain("import { Invoice } from '$lib/modules/billing/Invoice';");
    });
  });
});

describe('MakeDeployCommand', () => {
  it('should expose the same Docker flags as make:docker', () => {
    const deployFlags = new MakeDeployCommand().flags.map((flag) => flag.name).sort();
    const dockerFlags = new MakeDockerCommand().flags.map((flag) => flag.name).sort();

    expect(deployFlags).toEqual(dockerFlags);
  });
});

describe('MakeDashboardCommand', () => {
  it('scaffolds monitor-backed queue, scheduler, and logs tabs', async () => {
    const cmd = new MakeDashboardCommand();
    await cmd.handle([], {});

    const pagePath = join(tmpDir, 'src', 'routes', 'admin', 'dashboard', '+page.svelte');
    const serverPath = join(tmpDir, 'src', 'routes', 'admin', 'dashboard', '+page.server.ts');
    const queueApiPath = join(tmpDir, 'src', 'routes', 'api', 'admin', 'queue', '+server.ts');

    expect(existsSync(pagePath)).toBe(true);
    expect(existsSync(serverPath)).toBe(true);
    expect(existsSync(queueApiPath)).toBe(true);

    const page = readFileSync(pagePath, 'utf-8');
    const server = readFileSync(serverPath, 'utf-8');
    const queueApi = readFileSync(queueApiPath, 'utf-8');

    expect(page).not.toContain('coming soon');
    expect(page).toContain('retryJob');
    expect(page).toContain('runTask');
    expect(page).toContain('data.logs?.logs');
    expect(page).toContain('data.stats.queue?.queues?.default?.total');
    expect(server).toContain('/api/admin/queue?limit=10');
    expect(server).toContain('/api/admin/scheduler');
    expect(server).toContain('/api/admin/logs?limit=25');
    expect(queueApi).toContain('JobMonitor.listJobs');
  });
});

// ── New project template tests ────────────────────────────

describe('New project templates', () => {
  it('includes local worker and scheduler dev scripts', () => {
    const pkg = JSON.parse(NewCommandTemplates.packageJson('example-app', '0.0.0'));

    expect(pkg.scripts['dev:worker']).toBe('node scripts/svelar-dev-runtime.mjs queue:work --queue=default');
    expect(pkg.scripts['dev:scheduler']).toBe('node scripts/svelar-dev-runtime.mjs schedule:run');
  });

  it('uses npm exec for generated shadcn-svelte installation', () => {
    const pkg = JSON.parse(NewCommandTemplates.packageJson('example-app', '0.0.0'));

    expect(pkg.scripts['ui:install']).toContain('npm exec --package shadcn-svelte@latest -- shadcn-svelte add --all --yes');
    expect(pkg.scripts['ui:install']).not.toContain('npx shadcn-svelte@latest');
  });

  it('keeps Valibot installed in Zod apps for Superforms adapter compatibility', () => {
    const pkg = JSON.parse(NewCommandTemplates.packageJson('example-app', '0.0.0', 'zod'));

    expect(pkg.dependencies.zod).toBeDefined();
    expect(pkg.dependencies.valibot).toBeDefined();
  });

  it('selects Valibot dependencies and schema templates when requested', () => {
    const pkg = JSON.parse(NewCommandTemplates.packageJson('example-app', '0.0.0', 'valibot'));
    const authSchema = NewCommandTemplates.authSchema('valibot');
    const adminSchema = NewCommandTemplates.adminSchema('valibot');

    expect(pkg.dependencies.valibot).toBeDefined();
    expect(pkg.dependencies.zod).toBeUndefined();
    expect(NewCommandTemplates.validationConfig('valibot')).toContain('"validation": "valibot"');
    expect(authSchema).toContain("import * as v from 'valibot'");
    expect(authSchema).toContain('v.forward(');
    expect(authSchema).toContain('v.InferOutput');
    expect(adminSchema).toContain('const positiveInteger');
    expect(adminSchema).toContain("v.picklist(['user', 'admin'])");
  });

  it('switches generated Superforms page servers to the Valibot adapter', () => {
    const template = NewCommandTemplates.applyValidationProvider(NewCommandTemplates.loginPageServer(), 'valibot');

    expect(template).toContain("import { valibot } from 'sveltekit-superforms/adapters'");
    expect(template).toContain('superValidate(valibot(loginSchema))');
    expect(template).toContain('superValidate(request, valibot(loginSchema))');
    expect(template).not.toContain('zod(');
  });

  it('generates the local Svelar dev runtime helper', () => {
    const script = NewCommandTemplates.svelarDevRuntimeScript();

    expect(script).toContain('PGBOUNCER_HOST_PORT');
    expect(script).toContain('REDIS_HOST_PORT');
    expect(script).toContain("spawn('npx', ['svelar'");
  });

  it('ships detailed Codex and Claude Svelar skills in generated apps', () => {
    const skill = NewCommandTemplates.codexSvelarSkill();

    expect(skill).toContain('Use Svelar CLI generators before hand-writing artifacts');
    expect(skill).toContain('For CRUD/API features, start with `npx svelar make:entity');
    expect(skill).toContain('Use controllers for HTTP/API resources');
    expect(skill).toContain('FormRequest validates and authorizes');
    expect(skill).toContain('DTO carries validated data into actions/services');
    expect(skill).toContain('## Hard Stops');
    expect(skill).toContain('Do not implement CRUD directly inside `src/routes/**/+server.ts`');
    expect(skill).toContain('Do not put validation, authorization, persistence, and response shaping all in a SvelteKit action or API route');
    expect(skill).toContain('## Data, Config, And Seeders');
    expect(skill).toContain('Never hardcode app data in routes, controllers, actions, services, repositories, or Svelte components');
    expect(skill).toContain('Schema changes go in migrations');
    expect(skill).toContain('Demo/default/reference data goes in seeders');
    expect(skill).toContain('Do not hardcode secrets, URLs, ports, bucket names, provider keys, feature flags, user IDs, team IDs, role IDs, or permission IDs');
    expect(skill).toContain('## Feature Checklist');
    expect(skill).toContain('npx svelar make:entity Invoice --module=billing');
    expect(skill).toContain('application/dto/<Dto>.ts');
    expect(skill).toContain('svelar.validation.json');
    expect(skill).toContain('@beeblock/svelar/validation/valibot');
    expect(skill).toContain('Use a narrow public application service/query/facade');
    expect(NewCommandTemplates.claudeSvelarSkill()).toBe(skill);
  });

  it('ships hard-stop Svelar conventions in generated root agent files', () => {
    const agents = NewCommandTemplates.agentsMd();

    expect(agents).toContain('For CRUD/API features, start with `npx svelar make:entity');
    expect(agents).toContain('## Hard Stops');
    expect(agents).toContain('Do not implement CRUD directly inside `src/routes/**/+server.ts`');
    expect(agents).toContain('Do not create a write path without a shared schema, FormRequest, DTO');
    expect(agents).toContain('Do not use raw SQL for normal CRUD/query work');
    expect(agents).toContain('## Data, Config, And Seeders');
    expect(agents).toContain('Demo/default/reference data goes in seeders');
    expect(agents).toContain('Runtime settings go through `.env`, `.env.example`, `src/app.ts`, and Svelar config helpers');
    expect(agents).toContain('## Feature Checklist');
    expect(NewCommandTemplates.claudeMd()).toBe(agents);
  });

  it('loads dotenv values into process.env for generated Vite dev and build runtime', () => {
    const template = NewCommandTemplates.viteConfig();

    expect(template).toContain("import { defineConfig, loadEnv } from 'vite'");
    expect(template).toContain("export default defineConfig(({ mode }) => {");
    expect(template).toContain("Object.assign(process.env, loadEnv(mode, process.cwd(), ''))");
  });

  it('uses CSRF-aware fetches for generated admin API mutations', () => {
    const template = NewCommandTemplates.adminPageSvelte();

    expect(template).toContain("getCookie('XSRF-TOKEN')");
    expect(template).toContain("'X-CSRF-Token'");
    expect(template).toContain('headers: csrfHeaders()');
    expect(template).toContain("headers: csrfHeaders({ 'Content-Type': 'application/json' })");
    expect(template).toContain('await refreshScheduler()');
    expect(template).toContain("apiError(res, 'Failed to run task')");
  });

  it('generates Node-testable SvelteKit hooks without virtual env imports', () => {
    const hooks = NewCommandTemplates.hooksServerTs();

    expect(hooks).toContain("import { createSvelarApp } from '@beeblock/svelar/hooks'");
    expect(hooks).toContain('secret: process.env.APP_KEY');
    expect(hooks).toContain("process.env.RATE_LIMIT_STORE === 'cache'");
    expect(hooks).toContain("csrfExcludePaths: ['/api/webhooks', '/api/internal/']");
    expect(hooks).not.toContain('$env/dynamic/private');
    expect(hooks).not.toContain('secret: env.APP_KEY');
  });

  it('wraps generated auth controllers with throttle middleware', () => {
    const login = NewCommandTemplates.apiAuthLogin();
    const register = NewCommandTemplates.apiAuthRegister();

    for (const template of [login, register]) {
      expect(template).toContain("process.env.RATE_LIMIT_STORE === 'cache'");
      expect(template).toContain('process.env.RATE_LIMIT_CACHE_STORE || process.env.CACHE_DRIVER');
      expect(template).not.toContain('$env/dynamic/private');
      expect(template).toContain('return throttle.handle(');
      expect(template).toContain("() => ctrl.handle('");
      expect(template).not.toContain('async () => {}');
    }
  });

  it('throttles generated browser auth page actions', () => {
    const templates = [
      NewCommandTemplates.loginPageServer(),
      NewCommandTemplates.registerPageServer(),
      NewCommandTemplates.forgotPasswordPageServer(),
      NewCommandTemplates.resetPasswordPageServer(),
      NewCommandTemplates.otpLoginPageServer(),
    ];

    for (const template of templates) {
      expect(template).toContain("import { ThrottleMiddleware } from '@beeblock/svelar/middleware'");
      expect(template).toContain("process.env.RATE_LIMIT_STORE === 'cache'");
      expect(template).toContain('process.env.RATE_LIMIT_CACHE_STORE || process.env.CACHE_DRIVER');
      expect(template).not.toContain('$env/dynamic/private');
      expect(template).toContain('throttleContext');
      expect(template).toContain('.check(ctx)');
      expect(template).toContain('.hit(ctx)');
    }
  });

  it('uses stable ids for generated OTP superforms', () => {
    const template = NewCommandTemplates.otpLoginPageServer();

    expect(template).toContain("superValidate(zod(otpRequestSchema), { id: 'otp-request' })");
    expect(template).toContain("superValidate(zod(otpVerifySchema), { id: 'otp-verify' })");
    expect(template).toContain("superValidate(request, zod(otpRequestSchema), { id: 'otp-request' })");
    expect(template).toContain("superValidate(request, zod(otpVerifySchema), { id: 'otp-verify' })");
  });
});

// ── Cross-type import path tests ──────────────────────────

describe('Make commands — Cross-type imports', () => {
  describe('Flat structure import paths', () => {
    it('MakeControllerCommand should use ../models/ path in flat mode', async () => {
      const cmd = new MakeControllerCommand();
      await cmd.handle(['PostController'], { resource: true, model: 'Post' });
      const filePath = join(tmpDir, 'src', 'lib', 'controllers', 'PostController.ts');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('$lib/models/Post.js');
    });

    it('MakeListenerCommand should use ../events/ path in flat mode', async () => {
      const cmd = new MakeListenerCommand();
      await cmd.handle(['SendNotification'], { event: 'PostCreated' });
      const filePath = join(tmpDir, 'src', 'lib', 'listeners', 'SendNotification.ts');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('$lib/events/PostCreated.js');
    });
  });

  describe('DDD structure import paths', () => {
    beforeEach(() => {
      mkdirSync(join(tmpDir, 'src', 'lib', 'modules'), { recursive: true });
    });

    it('MakeControllerCommand should use ./ path in DDD mode', async () => {
      const cmd = new MakeControllerCommand();
      await cmd.handle(['PostController'], { resource: true, model: 'Post', module: 'blog' });
      const filePath = join(tmpDir, 'src', 'lib', 'modules', 'blog', 'interface', 'http', 'controllers', 'PostController.ts');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('$lib/modules/blog/domain/models/Post.js');
    });

    it('MakeListenerCommand should use ./ path in DDD mode', async () => {
      const cmd = new MakeListenerCommand();
      await cmd.handle(['SendNotification'], { event: 'PostCreated', module: 'blog' });
      const filePath = join(tmpDir, 'src', 'lib', 'modules', 'blog', 'application', 'listeners', 'SendNotification.ts');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('$lib/modules/blog/domain/events/PostCreated.js');
    });

    it('MakeRouteCommand should import from the module that contains the controller', async () => {
      const controllerDir = join(tmpDir, 'src', 'lib', 'modules', 'billing', 'interface', 'http', 'controllers');
      mkdirSync(controllerDir, { recursive: true });
      writeFileSync(join(controllerDir, 'InvoiceController.ts'), 'export class InvoiceController {}');

      const cmd = new MakeRouteCommand();
      await cmd.handle(['invoices'], { api: true, resource: true, controller: 'InvoiceController' });

      const filePath = join(tmpDir, 'src', 'routes', 'api', 'invoices', '+server.ts');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain("$lib/modules/billing/interface/http/controllers/InvoiceController.js");
    });
  });
});
