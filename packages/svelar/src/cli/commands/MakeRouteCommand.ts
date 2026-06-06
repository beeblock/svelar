/**
 * make:route — Generate SvelteKit route files with controller wiring
 *
 * Creates +server.ts files in src/routes/ with proper controller bindings.
 * Never overwrites existing files.
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const rawPath = args[0];
    if (!rawPath) {
      this.error('Please provide a route path (e.g. posts, users/[id], admin/settings).');
      return;
    }

    // Normalize path
    let routePath = rawPath.replace(/^\//, '');
    if (flags.api && !routePath.startsWith('api/')) {
      routePath = 'api/' + routePath;
    }

    const controllerName = flags.controller || this.inferControllerName(routePath);
    const moduleName = flags.module || this.detectControllerModule(controllerName) || this.inferModuleName(routePath);

    if (flags.resource) {
      this.generateResourceRoutes(routePath, controllerName, moduleName);
    } else {
      this.generateRoute(routePath, controllerName, moduleName, flags.methods);
    }
  }

  private generateResourceRoutes(routePath: string, controllerName: string, moduleName: string): void {
    // Collection route: GET (index) + POST (store)
    this.generateRouteFile(
      routePath,
      controllerName,
      moduleName,
      [
        { method: 'GET', handler: 'index' },
        { method: 'POST', handler: 'store' },
      ],
    );

    // Single resource route: GET (show) + PUT (update) + DELETE (destroy)
    const paramName = this.inferParamName(routePath);
    this.generateRouteFile(
      `${routePath}/[${paramName}]`,
      controllerName,
      moduleName,
      [
        { method: 'GET', handler: 'show' },
        { method: 'PUT', handler: 'update' },
        { method: 'DELETE', handler: 'destroy' },
      ],
    );
  }

  private generateRoute(
    routePath: string,
    controllerName: string,
    moduleName: string,
    methods?: string,
  ): void {
    const methodList = methods
      ? methods.split(',').map((m) => m.trim().toUpperCase())
      : ['GET'];

    const bindings = methodList.map((method) => ({
      method,
      handler: this.defaultHandler(method),
    }));

    this.generateRouteFile(routePath, controllerName, moduleName, bindings);
  }

  private generateRouteFile(
    routePath: string,
    controllerName: string,
    moduleName: string,
    bindings: { method: string; handler: string }[],
  ): void {
    const routesDir = join(process.cwd(), 'src', 'routes', ...routePath.split('/'));
    mkdirSync(routesDir, { recursive: true });

    const filePath = join(routesDir, '+server.ts');
    if (existsSync(filePath)) {
      this.warn(`Route already exists: src/routes/${routePath}/+server.ts (skipped)`);
      return;
    }

    const importPath = this.moduleAliasPath(moduleName, 'controllers', `${controllerName}.js`, 'controller');

    const exports = bindings
      .map((b) => `export const ${b.method} = ctrl.handle('${b.handler}');`)
      .join('\n');

    const content = `import { ${controllerName} } from '${importPath}';

const ctrl = new ${controllerName}();
${exports}
`;

    writeFileSync(filePath, content);
    this.success(`Route created: src/routes/${routePath}/+server.ts`);
    for (const b of bindings) {
      this.info(`  ${b.method} /${routePath} → ${controllerName}.${b.handler}()`);
    }
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
      this.warn(`Controller ${controllerName} exists in multiple modules (${matches.join(', ')}). Using "${matches[0]}".`);
      return matches[0];
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
