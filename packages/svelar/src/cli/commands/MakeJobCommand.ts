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
    const jobsDir = join(process.cwd(), 'src', 'lib', 'jobs');
    mkdirSync(jobsDir, { recursive: true });

    const filePath = join(jobsDir, `${jobName}.ts`);
    if (existsSync(filePath)) {
      this.warn(`Job ${jobName} already exists.`);
      return;
    }

    const content = `import { Job } from 'svelar/queue';

export class ${jobName} extends Job {
  maxAttempts = 3;      // Retry up to 3 times
  retryDelay = 60;      // Wait 60 seconds between retries
  queue = 'default';    // Queue name

  constructor(private data: any) {
    super();
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
    this.success(`Job created: src/lib/jobs/${jobName}.ts`);
  }
}
