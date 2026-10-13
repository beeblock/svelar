import { MigrateCommand } from '../cli/commands/MigrateCommand.js';
import { Connection } from '../database/Connection.js';
import { MigrationLock } from './MigrationLock.js';

export class LockedMigrateCommand extends MigrateCommand {
  name = 'deploy:migrate';
  description = 'Run forward migrations with exclusive persisted deployment ownership';
  flags = [
    { name: 'check', description: 'Check the installed lock foundation without running migrations', type: 'boolean' as const },
    { name: 'connection', description: 'Named database connection', type: 'string' as const },
  ];
  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    if (['rollback', 'reset', 'refresh', 'fresh', 'seed'].some(flag => flags[flag])) throw new Error('Deployment migrations only allow forward schema changes.');
    await this.bootstrap();
    const connectionName = flags.connection as string | undefined;
    if (flags.check) { await MigrationLock.check({ connectionName }); return; }
    await MigrationLock.run(() => Connection.usingConnection(connectionName, () => super.handle(args, {})), { connectionName });
  }
}
