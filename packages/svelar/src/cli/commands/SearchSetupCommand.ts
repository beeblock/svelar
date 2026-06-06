/**
 * search:setup - Configure Meilisearch indexes for Searchable models
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from '../Command.js';

type SearchableModel = {
  name?: string;
  configureSearchIndex?: (settings: Record<string, any>) => Promise<void>;
  makeAllSearchable?: (batchSize?: number) => Promise<{ indexed: number }>;
  removeAllFromSearch?: () => Promise<void>;
  searchIndexSettings?: Record<string, any> | (() => Record<string, any> | Promise<Record<string, any>>);
  searchSettings?: Record<string, any> | (() => Record<string, any> | Promise<Record<string, any>>);
};

export class SearchSetupCommand extends Command {
  name = 'search:setup';
  description = 'Configure Meilisearch indexes for Searchable models';
  flags = [
    { name: 'reindex', description: 'Re-index all discovered searchable models after applying settings', type: 'boolean' as const },
    { name: 'fresh', description: 'Delete all documents before re-indexing; implies --reindex', type: 'boolean' as const },
    { name: 'batch-size', description: 'Batch size to use when re-indexing', type: 'string' as const, default: '500' },
  ];

  async handle(_args: string[], flags: Record<string, any>): Promise<void> {
    await this.bootstrap();

    const models = await this.discoverSearchableModels();
    if (models.length === 0) {
      this.warn('No Searchable models found in src/lib/models or src/lib/modules.');
      return;
    }

    const rows: string[][] = [];
    const batchSize = Number.parseInt(String(flags['batch-size'] ?? '500'), 10);
    const shouldReindex = Boolean(flags.reindex || flags.fresh);

    for (const model of models) {
      const name = model.name ?? 'AnonymousModel';
      const settings = await this.resolveSettings(model);

      if (settings && Object.keys(settings).length > 0) {
        await model.configureSearchIndex?.(settings);
      }

      let indexed = '';
      if (shouldReindex) {
        if (flags.fresh) {
          await model.removeAllFromSearch?.();
        }
        const result = await model.makeAllSearchable?.(Number.isFinite(batchSize) ? batchSize : 500);
        indexed = typeof result?.indexed === 'number' ? String(result.indexed) : 'done';
      }

      rows.push([
        name,
        settings && Object.keys(settings).length > 0 ? 'configured' : 'no settings',
        indexed,
      ]);
    }

    this.table(['Model', 'Settings', 'Indexed'], rows);
    this.success(`Search setup completed for ${models.length} model${models.length === 1 ? '' : 's'}.`);
  }

  private async resolveSettings(model: SearchableModel): Promise<Record<string, any> | null> {
    const settings = model.searchIndexSettings ?? model.searchSettings;
    if (!settings) return null;
    return typeof settings === 'function' ? await settings() : settings;
  }

  private async discoverSearchableModels(): Promise<SearchableModel[]> {
    const roots = [
      join(process.cwd(), 'src', 'lib', 'models'),
      join(process.cwd(), 'src', 'lib', 'modules'),
    ];

    const files = roots.flatMap((root) => this.listModelFiles(root));
    const models: SearchableModel[] = [];

    for (const file of files) {
      try {
        const mod = await this.importUserModule(file);
        for (const exported of [mod.default, ...Object.values(mod)]) {
          if (this.isSearchableModel(exported) && !models.includes(exported)) {
            models.push(exported);
          }
        }
      } catch (error: any) {
        this.warn(`Skipping ${file}: ${String(error?.message ?? error)}`);
      }
    }

    return models;
  }

  private listModelFiles(root: string): string[] {
    if (!existsSync(root)) return [];

    const files: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const fullPath = join(root, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.listModelFiles(fullPath));
      } else if ((entry.name.endsWith('.ts') || entry.name.endsWith('.js')) && !entry.name.endsWith('.d.ts')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  private isSearchableModel(value: unknown): value is SearchableModel {
    return (
      typeof value === 'function' &&
      typeof (value as SearchableModel).configureSearchIndex === 'function' &&
      typeof (value as SearchableModel).makeAllSearchable === 'function'
    );
  }
}
