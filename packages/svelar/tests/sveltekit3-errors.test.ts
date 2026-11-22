import { describe, expect, it, vi } from 'vitest';
import { ErrorHandler } from '../src/errors/Handler.js';

describe('SvelteKit 2 and 3 error hook contracts', () => {
  it('preserves Kit 3 expected error metadata without reporting it as an incident', () => {
    const report = vi.fn();
    const handler = new ErrorHandler({ debug: false, report }).handleSvelteKitError();
    const error = Object.freeze({ status: 403, message: 'Forbidden', code: 'board.move' });
    expect(handler({ kind: 'app', error, event: {} })).toEqual(error);
    expect(report).not.toHaveBeenCalled();
  });

  it.each(['framework', 'validation'] as const)('returns only safe fields for Kit 3 %s errors', (kind) => {
    const report = vi.fn();
    const handler = new ErrorHandler({ debug: true, report }).handleSvelteKitError();
    expect(handler({ kind, error: { status: 400, message: 'Invalid request', extra: 'not-public' },
      event: {}, issues: [{ input: 'password-value' }] })).toEqual({ status: 400, message: 'Invalid request' });
    expect(report).not.toHaveBeenCalled();
  });

  it('uses a safe status for Kit 3 unexpected errors without legacy top-level status', () => {
    const handler = new ErrorHandler({ debug: false, dontReport: [Error] }).handleSvelteKitError();
    const result = handler({ kind: 'unknown', error: new Error('database password'), event: {} });
    expect(result).toEqual({ status: 500, message: 'An unexpected error occurred' });
  });

  it('continues to accept the Kit 2 input contract', () => {
    const handler = new ErrorHandler({ debug: false, dontReport: [Error] }).handleSvelteKitError();
    expect(handler({ error: new Error('secret'), event: {}, status: 503, message: 'Service unavailable' }))
      .toEqual({ status: 503, message: 'An unexpected error occurred' });
  });
});
