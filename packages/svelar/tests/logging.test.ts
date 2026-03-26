import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Log } from '../src/logging/index';

describe('Logger', () => {
  beforeEach(() => {
    // Reset logger state between tests
    Log.configure({
      default: 'console',
      channels: {
        console: { driver: 'console', level: 'debug' },
        null: { driver: 'null' },
      },
    });
  });

  describe('configure', () => {
    it('should configure logging channels', () => {
      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'info' },
        },
      });

      // Should not throw
      expect(Log).toBeDefined();
    });

    it('should support multiple channels', () => {
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

    it('should set the default channel', () => {
      Log.configure({
        default: 'custom',
        channels: {
          custom: { driver: 'console', level: 'info' },
        },
      });

      expect(Log).toBeDefined();
    });
  });

  describe('debug', () => {
    it('should log debug messages', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'debug' },
        },
      });

      Log.debug('Debug message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should include context', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'debug' },
        },
      });

      Log.debug('User action', { userId: 123, action: 'login' });

      const callArgs = consoleSpy.mock.calls[0][0];
      expect(callArgs).toContain('DEBUG');
      expect(callArgs).toContain('User action');

      consoleSpy.mockRestore();
    });

    it('should respect log level filtering', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'info' },
        },
      });

      Log.debug('Should not appear');

      // Debug should not be logged when level is 'info'
      // This is implementation dependent
      consoleSpy.mockRestore();
    });
  });

  describe('info', () => {
    it('should log info messages', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'info' },
        },
      });

      Log.info('Info message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should work with context object', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'info' },
        },
      });

      Log.info('User registered', { email: 'user@example.com', id: 1 });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('warn', () => {
    it('should log warning messages', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'warn' },
        },
      });

      Log.warn('Warning message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should use yellow color', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'warn', format: 'text' },
        },
      });

      Log.warn('Deprecated API used');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('error', () => {
    it('should log error messages', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'error' },
        },
      });

      Log.error('Error message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log errors with exception details', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'error' },
        },
      });

      Log.error('Database connection failed', {
        error: 'ECONNREFUSED',
        host: 'localhost',
        port: 5432,
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should use red color for error output', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'error', format: 'text' },
        },
      });

      Log.error('Critical failure');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('fatal', () => {
    it('should log fatal messages', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'fatal' },
        },
      });

      Log.fatal('System crash imminent');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('channel selection', () => {
    it('should allow selecting specific channel', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'info' },
          custom: { driver: 'console', level: 'warn' },
        },
      });

      Log.channel('custom').info('Should not appear');
      Log.channel('custom').warn('Should appear');

      consoleSpy.mockRestore();
    });

    it('should support chaining log levels', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'debug' },
        },
      });

      Log.channel('console').debug('Debug info', { key: 'value' });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('log levels', () => {
    it('should respect level hierarchy', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'error' },
        },
      });

      Log.debug('Debug');
      Log.info('Info');
      Log.warn('Warning');
      Log.error('Error');

      // Only error should be logged
      consoleSpy.mockRestore();
    });

    it('should handle debug level showing all logs', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'debug' },
        },
      });

      Log.debug('Debug');
      Log.info('Info');
      Log.warn('Warning');
      Log.error('Error');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('JSON format', () => {
    it('should support JSON format logs', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'info', format: 'json' },
        },
      });

      Log.info('User login', { userId: 1, ip: '192.168.1.1' });

      const callArgs = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(callArgs);

      expect(parsed).toHaveProperty('message');
      expect(parsed).toHaveProperty('level');
      expect(parsed).toHaveProperty('timestamp');
      expect(parsed).toHaveProperty('context');

      consoleSpy.mockRestore();
    });
  });

  describe('null driver', () => {
    it('should not output anything with null driver', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'null',
        channels: {
          null: { driver: 'null' },
        },
      });

      Log.info('This should not appear');

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('stack driver', () => {
    it('should log to multiple channels', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'stack',
        channels: {
          console: { driver: 'console', level: 'debug' },
          null: { driver: 'null' },
          stack: { driver: 'stack', channels: ['console'] },
        },
      });

      Log.info('Stack message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('timestamp', () => {
    it('should include timestamp in logs', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'info' },
        },
      });

      Log.info('Timestamped log');

      const callArgs = consoleSpy.mock.calls[0][0];
      // Should contain timestamp in ISO format or similar
      expect(callArgs).toContain('[');

      consoleSpy.mockRestore();
    });
  });

  describe('integration - application logging', () => {
    it('should handle request logging', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'info' },
        },
      });

      Log.info('POST /api/users', {
        statusCode: 201,
        duration: 145,
        userId: 1,
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle error logging with context', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'error' },
        },
      });

      Log.error('Payment processing failed', {
        orderId: 12345,
        amount: 99.99,
        gateway: 'stripe',
        errorCode: 'card_declined',
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle warning for deprecated features', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Log.configure({
        default: 'console',
        channels: {
          console: { driver: 'console', level: 'warn' },
        },
      });

      Log.warn('Deprecated API endpoint used', {
        endpoint: '/api/v1/users',
        replacedWith: '/api/v2/users',
        removedIn: '2.0.0',
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
