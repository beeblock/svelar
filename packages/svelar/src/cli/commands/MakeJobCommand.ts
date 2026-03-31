/**
 * make:job — Generate a new queue job class
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeJobCommand extends Command {
  name = 'make:job';
  description = 'Create a new queue job class';
  arguments = ['name'];
  flags = [];

  async handle(args: string[]): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide a job name.');
      return;
    }

    const jobName = name.endsWith('Job') ? name : name;
    const jobsDir = this.sharedDir('jobs');
    mkdirSync(jobsDir, { recursive: true });

    const filePath = join(jobsDir, `${jobName}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Job ${jobName} already exists.`);
      return;
    }

    const content = `import { Job } from '@beeblock/svelar/queue';

export class ${jobName} extends Job {
  maxAttempts = 3;      // Retry up to 3 times
  retryDelay = 60;      // Wait 60 seconds between retries
  queue = 'default';    // Queue name

  data: any;

  constructor(data: any) {
    super();
    this.data = data;
  }

  async handle(): Promise<void> {
    // Implement your job logic here
    console.log('Processing ${jobName}...', this.data);
  }

  failed(error: Error): void {
    console.error('${jobName} permanently failed:', error.message);
  }

  retrying(attempt: number): void {
    console.log('${jobName} retrying, attempt', attempt);
  }
}
`;

    writeFileSync(filePath, content);
    const relPath = this.isDDD() ? `src/lib/shared/jobs/${jobName}.ts` : `src/lib/jobs/${jobName}.ts`;
    this.success(`Job created: ${relPath}`);
  }
}
