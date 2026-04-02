/**
 * Database assertions for tests.
 *
 * These helpers query the database and throw assertion errors
 * when the expectation is not met, integrating with any test runner.
 */

import { Connection } from '../database/Connection.js';

/**
 * Assert that a row matching `conditions` exists in the given table.
 */
export async function assertDatabaseHas(
  table: string,
  conditions: Record<string, any>,
  connectionName?: string,
): Promise<void> {
  const count = await countRows(table, conditions, connectionName);
  if (count === 0) {
    const condStr = JSON.stringify(conditions);
    throw new Error(
      `assertDatabaseHas failed: expected at least one row in "${table}" matching ${condStr}, but found none.`,
    );
  }
}

/**
 * Assert that no row matching `conditions` exists in the given table.
 */
export async function assertDatabaseMissing(
  table: string,
  conditions: Record<string, any>,
  connectionName?: string,
): Promise<void> {
  const count = await countRows(table, conditions, connectionName);
  if (count > 0) {
    const condStr = JSON.stringify(conditions);
    throw new Error(
      `assertDatabaseMissing failed: expected no rows in "${table}" matching ${condStr}, but found ${count}.`,
    );
  }
}

/**
 * Assert that the table has exactly `expected` rows matching
 * optional `conditions`. If conditions is omitted, counts all rows.
 */
export async function assertDatabaseCount(
  table: string,
  expected: number,
  conditions?: Record<string, any>,
  connectionName?: string,
): Promise<void> {
  const count = conditions
    ? await countRows(table, conditions, connectionName)
    : await countRows(table, {}, connectionName);

  if (count !== expected) {
    const condStr = conditions ? ` matching ${JSON.stringify(conditions)}` : '';
    throw new Error(
      `assertDatabaseCount failed: expected ${expected} row(s) in "${table}"${condStr}, but found ${count}.`,
    );
  }
}

// ── Internal ──

async function countRows(
  table: string,
  conditions: Record<string, any>,
  connectionName?: string,
): Promise<number> {
  const keys = Object.keys(conditions);
  let sql = `SELECT COUNT(*) AS cnt FROM "${table}"`;
  const params: any[] = [];

  if (keys.length > 0) {
    const clauses = keys.map((key) => {
      params.push(conditions[key]);
      return `"${key}" = ?`;
    });
    sql += ` WHERE ${clauses.join(' AND ')}`;
  }

  const rows = await Connection.raw(sql, params, connectionName);
  return Number(rows[0]?.cnt ?? 0);
}
