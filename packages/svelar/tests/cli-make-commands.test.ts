import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
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
import { MakeEventCommand } from '../src/cli/commands/MakeEventCommand.js';
import { MakeListenerCommand } from '../src/cli/commands/MakeListenerCommand.js';
import { MakeChannelCommand } from '../src/cli/commands/MakeChannelCommand.js';
import { MakeCommandCommand } from '../src/cli/commands/MakeCommandCommand.js';
import { MakeProviderCommand } from '../src/cli/commands/MakeProviderCommand.js';
import { MakePluginCommand } from '../src/cli/commands/MakePluginCommand.js';

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
      expect(content).toContain('class CleanupTokens extends ScheduledTask');
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
    it('should create model in src/lib/modules/{module}/', async () => {
      const cmd = new MakeModelCommand();
      await cmd.handle(['Post'], { module: 'blog' });
      const filePath = join(tmpDir, 'src', 'lib', 'modules', 'blog', 'Post.ts');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('class Post extends Model');
    });
  });

  describe('MakeControllerCommand (DDD)', () => {
    it('should create controller in src/lib/modules/{module}/', async () => {
      const cmd = new MakeControllerCommand();
      await cmd.handle(['PostController'], { module: 'blog' });
      const filePath = join(tmpDir, 'src', 'lib', 'modules', 'blog', 'PostController.ts');
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('MakeServiceCommand (DDD)', () => {
    it('should create service in src/lib/modules/{module}/', async () => {
      const cmd = new MakeServiceCommand();
      await cmd.handle(['PostService'], { module: 'blog' });
      const filePath = join(tmpDir, 'src', 'lib', 'modules', 'blog', 'PostService.ts');
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('MakeEventCommand (DDD)', () => {
    it('should create event in src/lib/modules/{module}/', async () => {
      const cmd = new MakeEventCommand();
      await cmd.handle(['PostCreated'], { module: 'blog' });
      const filePath = join(tmpDir, 'src', 'lib', 'modules', 'blog', 'PostCreated.ts');
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
});

// ── Cross-type import path tests ──────────────────────────

describe('Make commands — Cross-type imports', () => {
  describe('Flat structure import paths', () => {
    it('MakeControllerCommand should use ../models/ path in flat mode', async () => {
      const cmd = new MakeControllerCommand();
      await cmd.handle(['PostController'], { resource: true, model: 'Post' });
      const filePath = join(tmpDir, 'src', 'lib', 'controllers', 'PostController.ts');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('../models/Post.js');
    });

    it('MakeListenerCommand should use ../events/ path in flat mode', async () => {
      const cmd = new MakeListenerCommand();
      await cmd.handle(['SendNotification'], { event: 'PostCreated' });
      const filePath = join(tmpDir, 'src', 'lib', 'listeners', 'SendNotification.ts');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('../events/PostCreated.js');
    });
  });

  describe('DDD structure import paths', () => {
    beforeEach(() => {
      mkdirSync(join(tmpDir, 'src', 'lib', 'modules'), { recursive: true });
    });

    it('MakeControllerCommand should use ./ path in DDD mode', async () => {
      const cmd = new MakeControllerCommand();
      await cmd.handle(['PostController'], { resource: true, model: 'Post', module: 'blog' });
      const filePath = join(tmpDir, 'src', 'lib', 'modules', 'blog', 'PostController.ts');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('./Post.js');
    });

    it('MakeListenerCommand should use ./ path in DDD mode', async () => {
      const cmd = new MakeListenerCommand();
      await cmd.handle(['SendNotification'], { event: 'PostCreated', module: 'blog' });
      const filePath = join(tmpDir, 'src', 'lib', 'modules', 'blog', 'SendNotification.ts');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('./PostCreated.js');
    });
  });
});
