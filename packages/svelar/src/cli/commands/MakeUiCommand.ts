import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Command } from '../Command.js';
import { UiPatternTemplates, uiPatternNames, type UiPatternName } from './UiPatternTemplates.js';

export class MakeUiCommand extends Command {
  name = 'make:ui';
  description = 'Generate optional operational shadcn UI patterns';
  arguments = ['[pattern...]'];
  flags = [{ name: 'force', alias: 'f', description: 'Overwrite existing pattern files', type: 'boolean' as const }];

  files(patterns: readonly UiPatternName[] = uiPatternNames, ddd = this.isDDD()): Array<{ path: string; content: string }> {
    return UiPatternTemplates.files(patterns, ddd);
  }

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    this.generatorName(undefined, flags);
    const selected = args.length === 0 || (args.length === 1 && args[0] === 'all') ? [...uiPatternNames] : [...new Set(args.flatMap((value) => value.split(',')))];
    if (selected.length > uiPatternNames.length || selected.some((value) => !uiPatternNames.some((name) => name === value))) {
      throw new Error('Unknown UI pattern. Choose all, ' + uiPatternNames.join(', ') + '.');
    }
    const patterns = selected as UiPatternName[];
    const root = process.cwd();
    const missing = UiPatternTemplates.shadcnComponents(patterns).filter((name) =>
      !existsSync(this.containedPath(root, 'src/lib/components/ui', name, 'index.ts'))
      && !existsSync(this.containedPath(root, 'src/lib/components/ui', name, 'index.js')));
    if (missing.length) throw new Error('Missing generated shadcn components: ' + missing.join(', ') + '. Run npm run ui:install first.');
    const files = this.files(patterns);
    const plan = files.map((file) => ({ ...file, absolute: this.containedPath(root, file.path) }));
    for (const file of plan) {
      if (!flags.force && /\/(?:contracts|helpers)\.ts$/.test(file.path) && existsSync(file.absolute) && readFileSync(file.absolute, 'utf8') !== file.content) {
        throw new Error('Shared pattern contracts differ: ' + file.path + '. Review them before using --force.');
      }
    }
    for (const file of plan) {
      if (existsSync(file.absolute) && !flags.force) { this.warn(file.path + ' already exists; preserved.'); continue; }
      mkdirSync(dirname(file.absolute), { recursive: true });
      writeFileSync(file.absolute, file.content);
      this.success('Created ' + file.path);
    }
  }
}
