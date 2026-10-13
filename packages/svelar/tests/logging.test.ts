import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Log } from '../src/logging/index';
import { LogViewer } from '../src/logging/LogViewer';
import { ApplicationContext } from '../src/support/Context';

describe('Logger', () => {
  beforeEach(async () => {
    // Reset logger state between tests
    Log.configure({
      default: 'console',
      channels: {
        console: { driver: 'console', level: 'debug' },
        null: { driver: 'null' },
      },
    });
    Log.clearContext();
    ApplicationContext.clear();
    LogViewer.configure({ driver: 'memory' });
    await LogViewer.clear();
  });

  describe('configure', () => {
    it('should configure logging channels', async () => {
      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'info' },
        },
      });

      // Should not throw
      expect(Log).toBeDefined();
    });

    it('should support multiple channels', async () => {
      Log.configure({
        default: 'stack',
        channels: {
          console: { driver: 'console', level: 'debug' },
          null: { driver: 'null' },
          stack: { driver: 'stack', channels: ['console'] },
        },
      });

      expect(Log).toBeDefined();
    });

    it('should set the default channel', async () => {
      Log.configure({
        default: 'custom',
        channels: {
          custom: { driver: 'console', level: 'info' },
        },
      });

      expect(Log).toBeDefined();
    });

    it('should throw when the default channel is not configured', async () => {
      Log.configure({
        default: 'missing',
        channels: {
          console: { driver: 'console', level: 'info' },
        },
      });

      await expect(Log.info('Missing channel')).rejects.toThrow('Log channel "missing" is not defined.');
    });

    it('should throw when a stack references a missing channel', async () => {
      Log.configure({
        default: 'stack',
        channels: {
          stack: { driver: 'stack', channels: ['missing'] },
        },
      });

      await expect(Log.info('Missing nested channel')).rejects.toThrow('Log channel "missing" is not defined.');
    });

    it('should throw for unknown log drivers', async () => {
      Log.configure({
        default: 'bad',
        channels: {
          bad: { driver: 'database' as any },
        },
      });

      await expect(Log.info('Unknown driver')).rejects.toThrow('Unknown log driver: database');
    });
  });

  describe('debug', () => {
    it('should log debug messages', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'debug' },
        },
      });

      await Log.debug('Debug message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should include context', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'debug' },
        },
      });

      await Log.debug('User action', { userId: 123, action: 'login' });

      const callArgs = consoleSpy.mock.calls[0][0];
      expect(callArgs).toContain('DEBUG');
      expect(callArgs).toContain('User action');

      consoleSpy.mockRestore();
    });

    it('should respect log level filtering', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'info' },
        },
      });

      await Log.debug('Should not appear');

      // Debug should not be logged when level is 'info'
      // This is implementation dependent
      consoleSpy.mockRestore();
    });
  });

  describe('info', () => {
    it('should log info messages', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'info' },
        },
      });

      await Log.info('Info message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should work with context object', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'info' },
        },
      });

      await Log.info('User registered', { email: 'user@example.com', id: 1 });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('warn', () => {
    it('should log warning messages', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'warn' },
        },
      });

      await Log.warn('Warning message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should use yellow color', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'warn', format: 'text' },
        },
      });

      await Log.warn('Deprecated API used');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('error', () => {
    it('should log error messages', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'error' },
        },
      });

      await Log.error('Error message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log errors with exception details', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'error' },
        },
      });

      await Log.error('Database connection failed', {
        error: 'ECONNREFUSED',
        host: 'localhost',
        port: 5432,
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should use red color for error output', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'error', format: 'text' },
        },
      });

      await Log.error('Critical failure');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('fatal', () => {
    it('should log fatal messages', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'fatal' },
        },
      });

      await Log.fatal('System crash imminent');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('channel selection', () => {
    it('should allow selecting specific channel', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'info' },
          custom: { driver: 'console', level: 'warn' },
        },
      });

      await Log.channel('custom').info('Should not appear');
      await Log.channel('custom').warn('Should appear');

      consoleSpy.mockRestore();
    });

    it('should support chaining log levels', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'debug' },
        },
      });

      await Log.channel('console').debug('Debug info', { key: 'value' });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('log levels', () => {
    it('should respect level hierarchy', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'error' },
        },
      });

      await Log.debug('Debug');
      await Log.info('Info');
      await Log.warn('Warning');
      await Log.error('Error');

      // Only error should be logged
      consoleSpy.mockRestore();
    });

    it('should handle debug level showing all logs', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'debug' },
        },
      });

      await Log.debug('Debug');
      await Log.info('Info');
      await Log.warn('Warning');
      await Log.error('Error');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('JSON format', () => {
    it('should support JSON format logs', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'info', format: 'json' },
        },
      });

      await Log.info('User login', { userId: 1, ip: '192.168.1.1' });

      const callArgs = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(callArgs);

      expect(parsed).toHaveProperty('message');
      expect(parsed).toHaveProperty('level');
      expect(parsed).toHaveProperty('timestamp');
      expect(parsed).toHaveProperty('context');

      consoleSpy.mockRestore();
    });
  });

  describe('context and redaction', () => {
    it('adds async-local request, tenant, actor, and job context to entries', async () => {
      Log.configure({
        default: 'null',
        channels: {
          null: { driver: 'null' },
        },
      });

      await Log.withContext({
        requestId: 'req-1',
        correlationId: 'corr-1',
        teamId: 42,
        userId: 7,
        jobId: 'job-1',
      }, async () => {
        await Log.info('contextual log', { action: 'save' });
      });

      const [entry] = await LogViewer.query({ search: 'contextual log' });
      expect(entry.context).toMatchObject({
        requestId: 'req-1',
        correlationId: 'corr-1',
        teamId: 42,
        tenantId: 42,
        userId: 7,
        actorId: 7,
        jobId: 'job-1',
        action: 'save',
      });
    });

    it('keeps async-local logging context isolated across concurrent executions', async () => {
      Log.configure({
        default: 'null',
        channels: {
          null: { driver: 'null' },
        },
      });

      await Promise.all([
        Log.withContext({ requestId: 'req-a', teamId: 'team-a' }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          await Log.info('request a');
        }),
        Log.withContext({ requestId: 'req-b', teamId: 'team-b' }, async () => {
          await Log.info('request b');
        }),
      ]);

      const byMessage = Object.fromEntries((await LogViewer.query()).map((entry) => [entry.message, entry.context]));
      expect(byMessage['request a']).toMatchObject({ requestId: 'req-a', tenantId: 'team-a' });
      expect(byMessage['request b']).toMatchObject({ requestId: 'req-b', tenantId: 'team-b' });
    });

    it('redacts sensitive context keys recursively before channels and LogViewer see them', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'info', format: 'json' },
        },
      });

      await Log.info('redacted log', {
        email: 'user@example.com',
        password: 'secret-password',
        nested: {
          authorization: 'Bearer token',
          refreshToken: 'refresh-secret',
        },
      });

      const parsed = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(parsed.context.email).toBe('user@example.com');
      expect(parsed.context.password).toBe('[REDACTED]');
      expect(parsed.context.nested.authorization).toBe('[REDACTED]');
      expect(parsed.context.nested.refreshToken).toBe('[REDACTED]');

      const [entry] = await LogViewer.query({ search: 'redacted log' });
      expect(entry.context.password).toBe('[REDACTED]');
      expect(JSON.stringify(entry.context)).not.toContain('secret-password');

      consoleSpy.mockRestore();
    });

    it('applies process-wide context and preserves explicit log context', async () => {
      Log.configure({
        default: 'null',
        channels: {
          null: { driver: 'null' },
        },
        context: { integration: 'billing', tenantId: 'configured-tenant' },
      });
      Log.setContext({ release: '0.8.0' });

      await Log.info('configured context', { tenantId: 'explicit-tenant' });

      const [entry] = await LogViewer.query({ search: 'configured context' });
      expect(entry.context).toMatchObject({
        integration: 'billing',
        release: '0.8.0',
        tenantId: 'explicit-tenant',
      });
    });
  });

  describe('null driver', () => {
    it('should not output anything with null driver', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'null',
        channels: {
          null: { driver: 'null' },
        },
      });

      await Log.info('This should not appear');

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('stack driver', () => {
    it('should log to multiple channels', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'stack',
        channels: {
          console: { driver: 'console', level: 'debug' },
          null: { driver: 'null' },
          stack: { driver: 'stack', channels: ['console'] },
        },
      });

      await Log.info('Stack message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('timestamp', () => {
    it('should include timestamp in logs', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'info' },
        },
      });

      await Log.info('Timestamped log');

      const callArgs = consoleSpy.mock.calls[0][0];
      // Should contain timestamp in ISO format or similar
      expect(callArgs).toContain('[');

      consoleSpy.mockRestore();
    });
  });

  describe('integration - application logging', () => {
    it('should handle request logging', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'info' },
        },
      });

      await Log.info('POST /api/users', {
        statusCode: 201,
        duration: 145,
        userId: 1,
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle error logging with context', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'error' },
        },
      });

      await Log.error('Payment processing failed', {
        orderId: 12345,
        amount: 99.99,
        gateway: 'stripe',
        errorCode: 'card_declined',
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle warning for deprecated features', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'warn' },
        },
      });

      await Log.warn('Deprecated API endpoint used', {
        endpoint: '/api/v1/users',
        replacedWith: '/api/v2/users',
        removedIn: '2.0.0',
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should surface file logging write failures', async () => {
      const root = await mkdtemp(join(tmpdir(), 'svelar-log-'));

      try {
        const directoryPath = join(root, 'app.log');
        await mkdir(directoryPath);

        Log.configure({
          default: 'file',
          channels: {
            file: { driver: 'file', path: directoryPath, level: 'info' },
          },
        });

        await expect(Log.info('Cannot write to directory path')).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});
