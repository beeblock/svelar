import { afterEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/database/Connection.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await Connection.disconnect();
});

describe('PostgreSQL query preparation', () => {
  it.each([true, false, undefined])('passes the explicit prepare policy to unsafe (%s)', async (prepare) => {
    Connection.configure({ default: 'main', connections: { main: { driver: 'postgres', prepare } } });
    const unsafe = vi.fn(async () => [{ id: 7 }]);
    vi.spyOn(Connection, 'connection').mockResolvedValue({});
    vi.spyOn(Connection, 'rawClient').mockResolvedValue({ unsafe });

    expect(await Connection.raw('SELECT id FROM users WHERE id = ?', [7])).toEqual([{ id: 7 }]);
    expect(unsafe).toHaveBeenCalledExactlyOnceWith('SELECT id FROM users WHERE id = $1', [7], { prepare: prepare === true });
  });

  it('uses the named connection policy inside transactions and savepoints', async () => {
    Connection.configure({ default: 'pooled', connections: {
      pooled: { driver: 'postgres', prepare: false },
      direct: { driver: 'postgres', prepare: true },
    } });
    const unsafe = vi.fn(async () => []);
    const nested = { unsafe };
    const transaction = { unsafe, savepoint: async (run: (client: typeof nested) => Promise<unknown>) => run(nested) };
    const pool = { begin: async (run: (client: typeof transaction) => Promise<unknown>) => run(transaction) };
    vi.spyOn(Connection, 'connection').mockResolvedValue({});
    vi.spyOn(Connection, 'rawClient').mockResolvedValueOnce(pool);

    await Connection.transaction(async () => {
      await Connection.raw('SELECT ?', [1], 'direct');
      await Connection.transaction(() => Connection.raw('SELECT ?', [2], 'direct'), 'direct');
    }, 'direct');

    expect(unsafe.mock.calls).toEqual([
      ['SELECT $1', [1], { prepare: true }],
      ['SELECT $1', [2], { prepare: true }],
    ]);
  });

  it.each([
    { name: 'booleans', values: [true, false], encoded: '{true,false}' },
    { name: 'bigints', values: [1n, 2n], encoded: '{1,2}' },
    { name: 'UUIDs', values: ['018f2d70-a000-7000-8000-000000000001'], encoded: '{"018f2d70-a000-7000-8000-000000000001"}' },
    { name: 'empty arrays', values: [], encoded: '{}' },
    { name: 'dates and nulls', values: [new Date('2026-11-22T00:00:00Z'), null], encoded: '{"2026-11-22T00:00:00.000Z",null}' },
    { name: 'nested arrays', values: [[1, 2], [3, 4]], encoded: '{{1,2},{3,4}}' },
    { name: 'binary values', values: [Buffer.from([0, 255])], encoded: '{"\\\\x00ff"}' },
    { name: 'JSON objects', values: [{ label: 'one' }], encoded: '{"{\\"label\\":\\"one\\"}"}' },
    { name: 'escaped text', values: ['comma,brace}', 'quote"slash\\', 'NULL'], encoded: '{"comma,brace}","quote\\"slash\\\\","NULL"}' },
  ])(
    'leaves array OID inference to PostgreSQL for $name', async ({ values, encoded }) => {
      Connection.configure({ default: 'main', connections: { main: { driver: 'postgres', prepare: true } } });
      const parameter = { value: encoded, type: 0 };
      const typed = vi.fn(() => parameter);
      const unsafe = vi.fn(async () => []);
      vi.spyOn(Connection, 'connection').mockResolvedValue({});
      vi.spyOn(Connection, 'rawClient').mockResolvedValue({ typed, unsafe });
      await Connection.raw('SELECT * FROM records WHERE id = ANY(?)', [values]);
      expect(typed).toHaveBeenCalledExactlyOnceWith(encoded, 0);
      expect(unsafe).toHaveBeenCalledExactlyOnceWith('SELECT * FROM records WHERE id = ANY($1)', [parameter], { prepare: true });
    },
  );

  it('normalizes scalar dates without mutating caller bindings', async () => {
    Connection.configure({ default: 'main', connections: { main: { driver: 'postgres' } } });
    const instant = new Date('2026-11-22T00:00:00Z');
    const bindings = [instant];
    const unsafe = vi.fn(async () => []);
    vi.spyOn(Connection, 'connection').mockResolvedValue({});
    vi.spyOn(Connection, 'rawClient').mockResolvedValue({ unsafe });
    await Connection.raw('SELECT ?::timestamptz', bindings);
    expect(unsafe).toHaveBeenCalledExactlyOnceWith('SELECT $1::timestamptz', ['2026-11-22T00:00:00.000Z'], { prepare: false });
    expect(bindings[0]).toBe(instant);
  });

  it.each([undefined, Symbol('unsupported'), () => null, { toJSON: () => undefined }])('rejects unsupported array elements before sending SQL (%s)', async (value) => {
    Connection.configure({ default: 'main', connections: { main: { driver: 'postgres' } } });
    const unsafe = vi.fn();
    vi.spyOn(Connection, 'connection').mockResolvedValue({});
    vi.spyOn(Connection, 'rawClient').mockResolvedValue({ unsafe });
    await expect(Connection.raw('SELECT ?::text[]', [[value]])).rejects.toThrow('serializable values');
    expect(unsafe).not.toHaveBeenCalled();
  });
});
