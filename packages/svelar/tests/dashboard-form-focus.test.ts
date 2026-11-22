import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { compile, parse } from 'svelte/compiler';
import { zod4Client } from 'sveltekit-superforms/adapters';
import { MakeDashboardCommand } from '../src/cli/commands/MakeDashboardCommand.js';
import { dashboardRoleCreateSchema, dashboardUserRoleSchema, dashboardUserCapabilitySchema } from '../src/dashboard/schemas.js';

const kinds = ['role', 'assignment', 'capability'] as const;
type Kind = typeof kinds[number];
const schemas = { role: dashboardRoleCreateSchema, assignment: dashboardUserRoleSchema, capability: dashboardUserCapabilitySchema };
const functions = ['validateManagementForm', 'createRole', 'userRoleChange', 'userCapabilityChange'];

function generated(ddd = true) {
  const file = new MakeDashboardCommand().files(undefined, ddd ? '$lib/shared/access' : '$lib/access')
    .find((file) => file.path === 'src/routes/admin/dashboard/+page.svelte')!;
  const instance = parse(file.content).instance!.content;
  const script = ts.createSourceFile('dashboard.ts', file.content.slice(instance.start, instance.end), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return { file, script };
}

function harness(kind: Kind, valid = false) {
  const { script } = generated();
  const source = script.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node)
    && functions.includes(node.name?.text ?? '')).map((node) => node.getText(script)).join('\n');
  const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const pending: Record<string, boolean> = {};
  const focus = vi.fn(() => { expect(pending['management-validate']).toBe(false); });
  const querySelector = vi.fn((): { focus: typeof focus } | null => ({ focus }));
  const tick = vi.fn(async () => {});
  const dialog = { open: true, querySelector };
  let input: Record<string, unknown> = {};
  const validator = zod4Client(schemas[kind]);
  const validateForm = vi.fn(async (options: { update: boolean; focusOnError: boolean }) => {
    expect(pending['management-validate']).toBe(true);
    expect(options).toEqual({ update: true, focusOnError: false });
    const result = await validator.validate(input);
    if (result.success) return { valid: true, data: result.data, errors: {} };
    const errors: Record<string, string[]> = {};
    for (const issue of result.issues) (errors[String(issue.path?.[0] ?? '_errors')] ??= []).push(issue.message);
    return { valid: false, data: input, errors };
  });
  const form = { validateForm };
  const store = { set: (value: Record<string, unknown>) => { input = value; } };
  const bindings = { pending, managementBusy: false, snapshotMatches: true, managedUser: { id: '17', email: 'member@example.test' },
    managementDialog: dialog, tick, assignmentScope: () => ({ scope: 'platform' }),
    roleCreateForm: form, userRoleForm: form, userCapabilityForm: form,
    roleCreateValues: store, userRoleValues: store, userCapabilityValues: store,
    $roleCreateValues: { name: valid ? 'reviewed-role' : 'owner', label: 'Reviewed role' } };
  const component = new Function(...Object.keys(bindings), `let formErrors = {}; let formError = ''; let confirmation = null;
    ${javascript}
    return {createRole,userRoleChange,userCapabilityChange,get confirmation(){return confirmation},get errors(){return formErrors}};`)(...Object.values(bindings));
  const run = () => kind === 'role' ? component.createRole()
    : kind === 'assignment' ? component.userRoleChange(valid ? 3 : 0, false)
      : component.userCapabilityChange(valid ? 'screen.items.view' : '', false);
  return { component, run, pending, focus, querySelector, tick, dialog, validateForm };
}

describe('Generated manual SPA validation focus', () => {
  it.each(kinds)('awaits rendered, enabled first-error focus for invalid %s without a confirmation or deferred SDK focus', async (kind) => {
    const h = harness(kind);
    let rendered!: () => void;
    let started!: () => void;
    const startedTick = new Promise<void>((resolve) => { started = resolve; });
    h.tick.mockImplementationOnce(() => { started(); return new Promise<void>((resolve) => { rendered = resolve; }); });
    let completed = false;
    const validation = h.run().then(() => { completed = true; });
    await startedTick;
    expect(h.pending['management-validate']).toBe(false);
    expect(h.focus).not.toHaveBeenCalled();
    expect(completed).toBe(false);
    rendered();
    await validation;
    expect(h.querySelector).toHaveBeenCalledExactlyOnceWith('[aria-invalid="true"]:not(:disabled)');
    expect(h.focus).toHaveBeenCalledExactlyOnceWith();
    expect(h.component.confirmation).toBeNull();
    expect(h.component.errors._root).toEqual([]);
    expect(h.validateForm).toHaveBeenCalledExactlyOnceWith({ update: true, focusOnError: false });
  });

  it.each(kinds)('preserves real shared-schema validation and confirmation for valid %s without moving focus', async (kind) => {
    const h = harness(kind, true);
    await h.run();
    expect(h.component.confirmation).toMatchObject({ method: 'POST', body: { scope: 'platform', confirmed: true } });
    expect(h.component.confirmation.url).toBe(kind === 'role' ? '/api/admin/permissions/roles'
      : '/api/admin/users/17/' + (kind === 'assignment' ? 'roles' : 'capabilities'));
    expect(h.pending['management-validate']).toBe(false);
    expect(h.focus).not.toHaveBeenCalled();
    expect(h.querySelector).not.toHaveBeenCalled();
  });

  it.each(kinds)('unlocks %s when validation throws without inventing errors or stealing focus', async (kind) => {
    const h = harness(kind);
    const error = new Error('Validation adapter unavailable');
    h.validateForm.mockRejectedValueOnce(error);
    await expect(h.run()).rejects.toBe(error);
    expect(h.pending['management-validate']).toBe(false);
    expect(h.tick).toHaveBeenCalledOnce();
    expect(h.focus).not.toHaveBeenCalled();
    expect(h.component.confirmation).toBeNull();
  });

  it('does not focus a closed management dialog or fail when no invalid control remains', async () => {
    const closed = harness('role');
    closed.dialog.open = false;
    await closed.run();
    expect(closed.querySelector).not.toHaveBeenCalled();
    const absent = harness('role');
    absent.querySelector.mockReturnValue(null);
    await absent.run();
    expect(absent.focus).not.toHaveBeenCalled();
  });

  it.each(kinds)('configures %s with public SDK options and cancels submission before the unchanged manual command', (kind) => {
    const { script } = generated();
    const name = kind === 'role' ? 'roleCreateForm' : kind === 'assignment' ? 'userRoleForm' : 'userCapabilityForm';
    const declarations = script.statements.filter(ts.isVariableStatement).flatMap((node) => [...node.declarationList.declarations]);
    const call = declarations.find((node) => node.name.getText(script) === name)!.initializer as ts.CallExpression;
    const command = vi.fn();
    const validator = zod4Client(schemas[kind]);
    const values = { roleCreateValidator: validator, userRoleValidator: validator, userCapabilityValidator: validator,
      createRole: command, userRoleChange: command, userCapabilityChange: command,
      $userRoleValues: { roleId: 3 }, $userCapabilityValues: { capability: 'screen.items.view' } };
    const options = new Function(...Object.keys(values), 'return (' + call.arguments[1].getText(script) + ');')(...Object.values(values));
    expect(options).toMatchObject({ SPA: true, dataType: 'json', resetForm: false, autoFocusOnError: false, validators: validator });
    const cancel = vi.fn();
    options.onSubmit({ cancel });
    expect(cancel).toHaveBeenCalledOnce();
    expect(command).toHaveBeenCalledOnce();
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(command.mock.invocationCallOrder[0]);
  });

  it.each([true, false])('compiles the actual generated component for client and server (DDD=%s)', (ddd) => {
    const { file } = generated(ddd);
    for (const generate of ['client', 'server'] as const) expect(() => compile(file.content, { filename: file.path, generate })).not.toThrow();
  });
});
