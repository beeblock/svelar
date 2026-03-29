/**
 * routes:list — List all application routes
 *
 * Scans src/routes/ for +server.ts and +page.server.ts files
 * and displays them in a table with HTTP methods, paths, and handlers.
 */

import { Command } from '../Command.js';
import { join, relative, sep } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

interface RouteEntry {
  method: string;
  path: string;
  handler: string;
  file: string;
}

export class RoutesListCommand extends Command {
  name = 'routes:list';
  description = 'List all registered routes';
  arguments = [];
  flags = [
    { name: 'json', description: 'Output as JSON', type: 'boolean' as const },
    { name: 'api', description: 'Show only API routes', type: 'boolean' as const },
    { name: 'method', alias: 'm', description: 'Filter by HTTP method (GET, POST, etc.)', type: 'string' as const },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    const routesDir = join(process.cwd(), 'src', 'routes');

    if (!existsSync(routesDir)) {
      this.error('No src/routes/ directory found.');
      return;
    }

    const routes = this.scanRoutes(routesDir, routesDir);

    // Apply filters
    let filtered = routes;
    if (flags.api) {
      filtered = filtered.filter((r) => r.path.startsWith('/api'));
    }
    if (flags.method) {
      const method = flags.method.toUpperCase();
      filtered = filtered.filter((r) => r.method === method);
    }

    // Sort by path, then method
    filtered.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

    if (filtered.length === 0) {
      this.warn('No routes found.');
      return;
    }

    if (flags.json) {
      this.log(JSON.stringify(filtered, null, 2));
      return;
    }

    // Display table
    this.log('');
    this.log(`  \x1b[1mApplication Routes\x1b[0m (${filtered.length} routes)\n`);

    // Calculate column widths
    const methodWidth = Math.max(6, ...filtered.map((r) => r.method.length));
    const pathWidth = Math.max(4, ...filtered.map((r) => r.path.length));
    const handlerWidth = Math.max(7, ...filtered.map((r) => r.handler.length));

    // Header
    const header = `  ${'METHOD'.padEnd(methodWidth)}  ${'PATH'.padEnd(pathWidth)}  ${'HANDLER'.padEnd(handlerWidth)}  FILE`;
    this.log(`\x1b[2m${header}\x1b[0m`);
    this.log(`\x1b[2m  ${'─'.repeat(methodWidth)}  ${'─'.repeat(pathWidth)}  ${'─'.repeat(handlerWidth)}  ${'─'.repeat(20)}\x1b[0m`);

    for (const route of filtered) {
      const methodColor = this.getMethodColor(route.method);
      const method = `${methodColor}${route.method.padEnd(methodWidth)}\x1b[0m`;
      const path = route.path.padEnd(pathWidth);
      const handler = `\x1b[2m${route.handler.padEnd(handlerWidth)}\x1b[0m`;
      const file = `\x1b[2m${route.file}\x1b[0m`;
      this.log(`  ${method}  ${path}  ${handler}  ${file}`);
    }

    this.log('');
  }

  private scanRoutes(dir: string, rootDir: string): RouteEntry[] {
    const routes: RouteEntry[] = [];
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        routes.push(...this.scanRoutes(fullPath, rootDir));
        continue;
      }

      if (entry === '+server.ts' || entry === '+server.js') {
        routes.push(...this.parseServerFile(fullPath, rootDir));
      } else if (entry === '+page.server.ts' || entry === '+page.server.js') {
        routes.push(...this.parsePageServerFile(fullPath, rootDir));
      }
    }

    return routes;
  }

  private parseServerFile(filePath: string, rootDir: string): RouteEntry[] {
    const routes: RouteEntry[] = [];
    const content = readFileSync(filePath, 'utf-8');
    const urlPath = this.filePathToUrl(filePath, rootDir);
    const relFile = relative(process.cwd(), filePath).split(sep).join('/');

    // Match exported HTTP methods: export const GET, export const POST, etc.
    const methodRegex = /export\s+(?:const|function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
    let match: RegExpExecArray | null;

    while ((match = methodRegex.exec(content)) !== null) {
      const method = match[1];
      const handler = this.extractHandler(content, method);
      routes.push({
        method,
        path: urlPath,
        handler,
        file: relFile,
      });
    }

    return routes;
  }

  private parsePageServerFile(filePath: string, rootDir: string): RouteEntry[] {
    const routes: RouteEntry[] = [];
    const content = readFileSync(filePath, 'utf-8');
    const urlPath = this.filePathToUrl(filePath, rootDir);
    const relFile = relative(process.cwd(), filePath).split(sep).join('/');

    // +page.server.ts exports load and actions
    if (/export\s+(const|async\s+function)\s+load\b/.test(content)) {
      routes.push({ method: 'GET', path: urlPath, handler: 'load()', file: relFile });
    }

    // Form actions: export const actions = { default, login, register }
    const actionsMatch = content.match(/export\s+const\s+actions\s*=\s*\{([^}]+)\}/);
    if (actionsMatch) {
      const actionNames = actionsMatch[1]
        .split(',')
        .map((a) => a.trim().split(':')[0].split('(')[0].trim())
        .filter(Boolean);

      for (const name of actionNames) {
        routes.push({
          method: 'POST',
          path: name === 'default' ? urlPath : `${urlPath}?/${name}`,
          handler: `actions.${name}()`,
          file: relFile,
        });
      }
    }

    return routes;
  }

  private filePathToUrl(filePath: string, rootDir: string): string {
    let rel = relative(rootDir, filePath).split(sep).join('/');

    // Remove +server.ts, +page.server.ts
    rel = rel.replace(/\/?\+(?:server|page\.server)\.[tj]s$/, '');

    // Convert SvelteKit param syntax to express-style
    // [id] → :id, [...rest] → *rest, [[optional]] → :optional?
    rel = rel
      .replace(/\[\.\.\.(\w+)\]/g, '*$1')
      .replace(/\[\[(\w+)\]\]/g, ':$1?')
      .replace(/\[(\w+)\]/g, ':$1');

    // Remove route groups: (group)/path → path
    rel = rel.replace(/\([^)]+\)\//g, '');

    return '/' + rel || '/';
  }

  private extractHandler(content: string, method: string): string {
    // Try to find ctrl.handle('methodName') pattern
    const ctrlPattern = new RegExp(
      `export\\s+const\\s+${method}\\s*=\\s*(\\w+)\\.handle\\(['"]([^'"]+)['"]\\)`,
    );
    const ctrlMatch = content.match(ctrlPattern);
    if (ctrlMatch) {
      return `${ctrlMatch[1]}.${ctrlMatch[2]}()`;
    }

    // Try to find resource() pattern
    const resourcePattern = new RegExp(
      `const\\s*\\{[^}]*${method}[^}]*\\}\\s*=\\s*resource\\(\\s*(\\w+)`,
    );
    const resourceMatch = content.match(resourcePattern);
    if (resourceMatch) {
      const controllerName = resourceMatch[1];
      const methodMap: Record<string, string> = {
        GET: 'index/show',
        POST: 'store',
        PUT: 'update',
        PATCH: 'update',
        DELETE: 'destroy',
      };
      return `${controllerName}.${methodMap[method] ?? method.toLowerCase()}()`;
    }

    // Try to find inline async function
    const inlinePattern = new RegExp(
      `export\\s+(?:const|async\\s+function)\\s+${method}\\s*(?:=\\s*async)?`,
    );
    if (inlinePattern.test(content)) {
      return 'inline handler';
    }

    return 'handler';
  }

  private getMethodColor(method: string): string {
    const colors: Record<string, string> = {
      GET: '\x1b[32m',      // green
      POST: '\x1b[33m',     // yellow
      PUT: '\x1b[34m',      // blue
      PATCH: '\x1b[34m',    // blue
      DELETE: '\x1b[31m',   // red
      HEAD: '\x1b[2m',      // dim
      OPTIONS: '\x1b[2m',   // dim
    };
    return colors[method] || '';
  }
}
