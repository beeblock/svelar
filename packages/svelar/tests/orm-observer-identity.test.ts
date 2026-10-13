import { afterEach, describe, expect, it, vi } from 'vitest';
import { Model } from '../src/orm/Model.js';

afterEach(() => vi.restoreAllMocks());
describe('Model observer constructor identity', () => {
  it('keeps hooks/observers isolated for distinct module models sharing the same class name', async () => {
    const AuthRecord = class User extends Model { static events = ['verified']; };
    const BillingRecord = class User extends Model { static events = ['verified']; };
    const authHook = vi.fn(); const billingHook = vi.fn();
    const authObserver = vi.fn(); const billingObserver = vi.fn();
    AuthRecord.boot({ created: authHook }); BillingRecord.boot({ created: billingHook });
    AuthRecord.observe({ created: authObserver, verified: authObserver } as any);
    BillingRecord.observe({ created: billingObserver, verified: billingObserver } as any);
    const auth = new AuthRecord(); const billing = new BillingRecord();
    await (auth as any).fireHook('created');
    expect(authHook).toHaveBeenCalledOnce(); expect(authObserver).toHaveBeenCalledOnce();
    expect(billingHook).not.toHaveBeenCalled(); expect(billingObserver).not.toHaveBeenCalled();
    AuthRecord.removeObservers();
    await billing.fireEvent('verified');
    expect(billingObserver).toHaveBeenCalledOnce();
    await (billing as any).fireHook('created');
    expect(billingHook).toHaveBeenCalledOnce(); expect(billingObserver).toHaveBeenCalledTimes(2);
  });
});
