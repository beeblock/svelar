import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { Command } from '../Command.js';

type Severity = 'error' | 'warning';

interface Finding {
  severity: Severity;
  rule: string;
  file: string;
  line: number;
  message: string;
}

const ROUTE_FILES = new Set(['+server.ts', '+server.js', '+page.server.ts', '+page.server.js']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.svelte']);
const MUTATING_METHOD_PATTERN = /method\s*:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/i;

export class LintArchitectureCommand extends Command {
  name = 'lint:architecture';
  description = 'Detect Svelar architecture convention violations';
  arguments = [];
  flags = [
    { name: 'json', description: 'Output findings as JSON', type: 'boolean' as const },
    { name: 'warnings', description: 'Include warnings in the failure exit code', type: 'boolean' as const, default: false },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    const srcDir = join(process.cwd(), 'src');
    if (!existsSync(srcDir)) {
      this.warn('No src/ directory found.');
      return;
    }

    const findings = this.scanProject(srcDir);
    const errors = findings.filter((finding) => finding.severity === 'error');
    const warnings = findings.filter((finding) => finding.severity === 'warning');

    if (flags.json) {
      this.log(JSON.stringify({ errors: errors.length, warnings: warnings.length, findings }, null, 2));
    } else if (findings.length === 0) {
      this.success('No architecture violations found.');
    } else {
      this.log('');
      this.log(`  Svelar Architecture Lint (${errors.length} errors, ${warnings.length} warnings)\n`);
      this.table(
        ['Severity', 'Rule', 'Location', 'Message'],
        findings.map((finding) => [
          finding.severity,
          finding.rule,
          `${finding.file}:${finding.line}`,
          finding.message,
        ]),
      );
      this.log('');
    }

    if (errors.length > 0 || (flags.warnings && warnings.length > 0)) {
      throw new Error('Architecture lint failed.');
    }
  }

  scanProject(srcDir: string): Finding[] {
    const files = this.listSourceFiles(srcDir);
    const findings: Finding[] = [];
    const rel = (file: string) => relative(process.cwd(), file).split(sep).join('/');

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      const relativeFile = rel(file);
      const basename = file.split(sep).at(-1) ?? file;

      if (ROUTE_FILES.has(basename)) {
        findings.push(...this.checkRouteFile(relativeFile, content));
      }

      findings.push(...this.checkRuntimePersistence(relativeFile, content));
      findings.push(...this.checkRuntimeDdl(relativeFile, content));
      findings.push(...this.checkMutatingFetch(relativeFile, content));
      findings.push(...this.checkWriteFlow(relativeFile, content, files.map(rel)));
    }

    return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  }

  private listSourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.svelte-kit' || entry === 'build' || entry === 'dist') continue;
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...this.listSourceFiles(fullPath));
        continue;
      }
      if (Array.from(SOURCE_EXTENSIONS).some((ext) => fullPath.endsWith(ext))) {
        files.push(fullPath);
      }
    }
    return files;
  }

  private checkRouteFile(file: string, content: string): Finding[] {
    const findings: Finding[] = [];
    const hasControllerBinding = /\b(resource|controller|new\s+\w+Controller|\w+Controller)\b/.test(content);
    const exportsMutation = /export\s+(?:async\s+)?(?:const|function)\s+(POST|PUT|PATCH|DELETE)\b/.test(content);
    const directlyPersists = /\b(QueryBuilder|Connection\.raw|\.insert\(|\.update\(|\.delete\(|\.create\(|\.save\()\b/.test(content);

    if (directlyPersists) {
      findings.push(this.finding('error', 'thin-routes', file, content, directlyPersistsLine(content), 'Route files must stay thin and delegate persistence to controllers/actions/repositories.'));
    }

    if (exportsMutation && !hasControllerBinding) {
      findings.push(this.finding('warning', 'controller-flow', file, content, 1, 'Mutating route should delegate to a controller or page action that uses FormRequest, DTO, and action/service layers.'));
    }

    return findings;
  }

  private checkRuntimePersistence(file: string, content: string): Finding[] {
    if (this.isAllowedPersistenceFile(file)) return [];

    const patterns = [
      { rule: 'repository-persistence', regex: /\bnew\s+QueryBuilder\b/, message: 'QueryBuilder usage belongs in repositories, models, migrations, or framework infrastructure.' },
      { rule: 'no-runtime-raw-sql', regex: /\bConnection\.raw\s*\(/, message: 'Raw SQL outside migrations/framework infrastructure needs a narrow infrastructure exception.' },
      { rule: 'repository-persistence', regex: /\.(insert|update|delete)\s*\(/, message: 'Persistence writes outside repositories/models/actions generated for the workflow should be reviewed.' },
    ];

    return patterns
      .filter((pattern) => pattern.regex.test(content))
      .map((pattern) => this.finding('warning', pattern.rule, file, content, this.regexLine(content, pattern.regex), pattern.message));
  }

  private checkRuntimeDdl(file: string, content: string): Finding[] {
    if (file.includes('/database/migrations/')) return [];
    const regex = /\.(createTable|dropTable|dropTableIfExists|renameTable|addColumn|dropColumn)\s*\(/;
    if (!regex.test(content)) return [];
    return [
      this.finding('error', 'no-runtime-ddl', file, content, this.regexLine(content, regex), 'Database schema changes must live in migrations, never runtime code.'),
    ];
  }

  private checkMutatingFetch(file: string, content: string): Finding[] {
    if (!content.includes('fetch(') || content.includes('apiFetch(')) return [];
    if (!MUTATING_METHOD_PATTERN.test(content)) return [];
    return [
      this.finding('warning', 'csrf-api-fetch', file, content, this.regexLine(content, MUTATING_METHOD_PATTERN), 'Mutating browser fetch calls should use apiFetch so CSRF headers and error handling are consistent.'),
    ];
  }

  private checkWriteFlow(file: string, content: string, allFiles: string[]): Finding[] {
    if (!file.includes('/application/actions/') && !file.includes('/actions/')) return [];
    if (!/\bclass\s+(Create|Update|Delete|Store|Save)\w*Action\b/.test(content)) return [];

    const base = file.replace(/Action\.(ts|js)$/, '');
    const hasDto = allFiles.some((candidate) => candidate.includes('/application/dto/') || candidate.includes('/dtos/'));
    const hasRequest = allFiles.some((candidate) => candidate.includes('/interface/http/requests/') || candidate.includes('/requests/') || candidate.includes('/dtos/'));
    const hasSchema = allFiles.some((candidate) => candidate.includes('/contracts/schemas/') || candidate.includes('/schemas/'));

    const missing = [
      !hasSchema ? 'shared schema' : null,
      !hasRequest ? 'FormRequest' : null,
      !hasDto ? 'DTO' : null,
    ].filter(Boolean);

    if (missing.length === 0) return [];
    return [
      this.finding('warning', 'write-flow', file, content, this.regexLine(content, /\bclass\s+/), `Write action appears to be missing ${missing.join(', ')} artifacts in the project.`),
    ];
  }

  private isAllowedPersistenceFile(file: string): boolean {
    return [
      '/infrastructure/repositories/',
      '/repositories/',
      '/domain/models/',
      '/models/',
      '/database/migrations/',
      '/database/seeders/',
      '/src/lib/database/',
    ].some((segment) => file.includes(segment));
  }

  private finding(severity: Severity, rule: string, file: string, content: string, line: number, message: string): Finding {
    return { severity, rule, file, line: Math.max(1, line), message };
  }

  private regexLine(content: string, regex: RegExp): number {
    const index = content.search(regex);
    return index < 0 ? 1 : content.slice(0, index).split('\n').length;
  }
}

function directlyPersistsLine(content: string): number {
  return content
    .split('\n')
    .findIndex((line) => /\b(QueryBuilder|Connection\.raw|\.insert\(|\.update\(|\.delete\(|\.create\(|\.save\()\b/.test(line)) + 1;
}
