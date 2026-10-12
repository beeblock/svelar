import { describe, expect, it } from 'vitest';
import { builtinCommandNames } from '../src/cli/BuiltinCommands.js';
import { cliExecutionGates } from '../../../scripts/cli-certification.mjs';

describe('CLI execution certification inventory', () => {
  it('requires an execution gate for every built-in command and rejects stale entries', () => {
    expect(Object.keys(cliExecutionGates()).sort()).toEqual(builtinCommandNames().sort());
  });
});
