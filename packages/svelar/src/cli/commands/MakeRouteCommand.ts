/**
 * make:route — Generate SvelteKit route files with controller wiring
 *
 * Creates +server.ts files in src/routes/ with proper controller bindings.
 * Never overwrites existing files.
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CapabilityScaffold, capabilityFlags, type CapabilityDecision } from '../CapabilityScaffold.js';

export class MakeRouteCommand extends Command {
  name = 'make:route';
  description = 'Create route files with controller bindings';
  arguments = ['path'];
  flags = [
    { name: 'controller', alias: 'c', description: 'Controller class name', type: 'string' as const },
    { name: 'resource', alias: 'r', description: 'Generate full CRUD resource routes', type: 'boolean' as const },
    { name: 'api', description: 'Prefix path with /api', type: 'boolean' as const },
    { name: 'methods', alias: 'm', description: 'HTTP methods (comma-separated: GET,POST,PUT,DELETE)', type: 'string' as const },
    { name: 'module', description: 'Module name for controller import path', type: 'string' as const },
    ...capabilityFlags,
    { name: 'permission', description: 'Existing canonical capability for a custom non-resource route', type: 'string' as const },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const rawPath = args[0];
    if (!rawPath) {
      this.error('Please provide a route path (e.g. posts, users/[id], admin/settings).');
      return;
    }

    // Normalize path
    if (typeof rawPath !== 'string' || rawPath.length > 1024 || rawPath.startsWith('//')) throw new Error('Route must be a bounded relative SvelteKit path.');
    let routePath = rawPath.replace(/^\//, '');
    if (!routePath || routePath.split('/').some((part) => !/^(?:[A-Za-z][A-Za-z0-9_-]*|\([A-Za-z][A-Za-z0-9_-]*\)|\[(?:\.\.\.)?[A-Za-z][A-Za-z0-9_]*(?:=[A-Za-z][A-Za-z0-9_]*)?\]|\[\[[A-Za-z][A-Za-z0-9_]*\]\])$/.test(part))) throw new Error('Route contains traversal, control characters or unsupported segments.');
    if (flags.api && !routePath.startsWith('api/')) {
      routePath = 'api/' + routePath;
    }

    let controllerName = this.generatorName(flags.controller || this.inferControllerName(routePath), flags)!;
    if (!controllerName.endsWith('Controller')) controllerName += 'Controller';
    const moduleName = flags.module || this.detectControllerModule(controllerName) || this.inferModuleName(routePath);
    this.moduleDir(moduleName, 'controllers', 'controller');
    if (flags.resource && flags.permission !== undefined) throw new Error('Resource routes require --capability or --public, not one broad --permission.');
    const logicalRoute = '/' + routePath.replace(/^api\//, '').split('/').filter((part) => !part.startsWith('(')).join('/');
    const decision = CapabilityScaffold.decision(flags, { route: logicalRoute }, true);
    const methodList: string[] = flags.methods ? String(flags.methods).split(',').map((method) => method.trim().toUpperCase()) : ['GET'];
    if (methodList.some((method) => !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method))) throw new Error('Unsupported HTTP method.');
    const specifications = flags.resource ? [
      { path: routePath, bindings: [{ method: 'GET', handler: 'index' }, { method: 'POST', handler: 'store' }] },
      { path: `${routePath}/[${this.inferParamName(routePath)}]`, bindings: [{ method: 'GET', handler: 'show' }, { method: 'PUT', handler: 'update' }, { method: 'DELETE', handler: 'destroy' }] },
    ] : [{ path: routePath, bindings: [...new Set(methodList)].map((method) => ({ method, handler: this.defaultHandler(method) })) }];
    for (const specification of specifications) this.containedPath(join(process.cwd(), 'src/routes'), ...specification.path.split('/'), '+server.ts');
    const actions = specifications.flatMap((specification) => specification.bindings.map((binding) => this.actionName(binding.handler)).filter((action): action is string => !!action));
    const plan = CapabilityScaffold.prepare(moduleName, controllerName.replace(/Controller$/, ''), decision, actions);
    for (const specification of specifications) {
      const path = this.containedPath(join(process.cwd(), 'src/routes'), ...specification.path.split('/'), '+server.ts');
      const expected = this.routeContent(controllerName, moduleName, specification.bindings, decision, plan.accessAlias);
      if (!decision.public && existsSync(path) && readFileSync(path, 'utf8') !== expected) throw new Error('Existing route differs from the protected scaffold. Review its guard before regenerating.');
    }
    for (const specification of specifications) this.generateRouteFile(specification.path, controllerName, moduleName, specification.bindings, decision, plan.accessAlias);
    plan.commit();
  }

  private generateRouteFile(
    routePath: string,
    controllerName: string,
    moduleName: string,
    bindings: { method: string; handler: string }[],
    decision: CapabilityDecision,
    accessAlias: string,
  ): void {
    const routesDir = this.containedPath(join(process.cwd(), 'src/routes'), ...routePath.split('/'));
    mkdirSync(routesDir, { recursive: true });

    const filePath = join(routesDir, '+server.ts');
    if (existsSync(filePath)) {
      this.warn(`Route already exists: src/routes/${routePath}/+server.ts (skipped)`);
      return;
    }

    const content = this.routeContent(controllerName, moduleName, bindings, decision, accessAlias);

    writeFileSync(filePath, content);
    this.success(`Route created: src/routes/${routePath}/+server.ts`);
    for (const b of bindings) {
      this.info(`  ${b.method} /${routePath} → ${controllerName}.${b.handler}()`);
    }
  }

  private actionName(handler: string): string | undefined { return ({ store: 'create', update: 'update', destroy: 'delete' } as Record<string, string>)[handler]; }

  private routeContent(controllerName: string, moduleName: string, bindings: { method: string; handler: string }[], decision: CapabilityDecision, accessAlias: string): string {
    const importPath = this.moduleAliasPath(moduleName, 'controllers', `${controllerName}.js`, 'controller');
    return `${decision.public ? '// svelar:public - functional RBAC exemption only; authentication and resource policies remain.\n' : ''}import { ${controllerName} } from '${importPath}';
${decision.public ? '' : `import { capabilityAccess, resolveCapabilityInput } from '${accessAlias}';\n`}
const ctrl = new ${controllerName}();
${bindings.map((binding) => {
  const action = this.actionName(binding.handler);
  const capability = decision.permission ?? (action ? `action.${decision.resource}.${action}` : `screen.${decision.resource}.view`);
  return `export const ${binding.method} = ${decision.public ? `ctrl.handle('${binding.handler}')` : `capabilityAccess.guardEndpoint('${capability}', ctrl.handle('${binding.handler}'), resolveCapabilityInput)`};`;
}).join('\n')}
`;
  }

  private inferControllerName(routePath: string): string {
    // api/posts/[id] → PostController
    // admin/settings → SettingController
    const segments = routePath
      .replace(/^api\//, '')
      .split('/')
      .filter((s) => !s.startsWith('['));

    const last = segments[segments.length - 1] || segments[0] || 'Index';
    const singular = this.singularize(last);
    const name = singular.charAt(0).toUpperCase() + singular.slice(1);
    return `${name}Controller`;
  }

  private inferModuleName(routePath: string): string {
    const segments = routePath
      .replace(/^api\//, '')
      .split('/')
      .filter((s) => !s.startsWith('['));

    return segments[0] || 'app';
  }

  private detectControllerModule(controllerName: string): string | undefined {
    if (!this.isDDD()) return undefined;

    const modulesDir = join(process.cwd(), 'src', 'lib', 'modules');
    if (!existsSync(modulesDir)) return undefined;

    const matches = readdirSync(modulesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((moduleName) =>
        existsSync(join(modulesDir, moduleName, 'interface', 'http', 'controllers', `${controllerName}.ts`))
        || existsSync(join(modulesDir, moduleName, 'interface', 'http', 'controllers', `${controllerName}.js`))
      );

    if (matches.length === 1) {
      return matches[0];
    }

    if (matches.length > 1) {
      throw new Error(`Controller ${controllerName} exists in multiple modules (${matches.join(', ')}); choose an explicit --module.`);
    }

    return undefined;
  }

  private inferParamName(routePath: string): string {
    // posts → id, users → id
    return 'id';
  }

  private defaultHandler(method: string): string {
    const map: Record<string, string> = {
      GET: 'index',
      POST: 'store',
      PUT: 'update',
      PATCH: 'update',
      DELETE: 'destroy',
    };
    return map[method] || method.toLowerCase();
  }

  private singularize(str: string): string {
    if (str.endsWith('ies')) return str.slice(0, -3) + 'y';
    if (str.endsWith('ses') || str.endsWith('xes') || str.endsWith('zes') || str.endsWith('ches') || str.endsWith('shes')) {
      return str.slice(0, -2);
    }
    if (str.endsWith('s') && !str.endsWith('ss')) return str.slice(0, -1);
    return str;
  }
}
