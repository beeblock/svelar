import type { Command } from './Command.js';

import { DevDownCommand } from './commands/DevDownCommand.js';
import { DevLogsCommand } from './commands/DevLogsCommand.js';
import { DevRestartCommand } from './commands/DevRestartCommand.js';
import { DevUpCommand } from './commands/DevUpCommand.js';
import { InfraSetupCommand } from './commands/InfraSetupCommand.js';
import { KeyGenerateCommand } from './commands/KeyGenerateCommand.js';
import { MakeActionCommand } from './commands/MakeActionCommand.js';
import { MakeBroadcastingCommand } from './commands/MakeBroadcastingCommand.js';
import { MakeChannelCommand } from './commands/MakeChannelCommand.js';
import { MakeCiCommand } from './commands/MakeCiCommand.js';
import { MakeCommandCommand } from './commands/MakeCommandCommand.js';
import { MakeConfigCommand } from './commands/MakeConfigCommand.js';
import { MakeControllerCommand } from './commands/MakeControllerCommand.js';
import { MakeDashboardCommand } from './commands/MakeDashboardCommand.js';
import { MakeDeployCommand } from './commands/MakeDeployCommand.js';
import { MakeDockerCommand } from './commands/MakeDockerCommand.js';
import { MakeDtoCommand } from './commands/MakeDtoCommand.js';
import { MakeEntityCommand } from './commands/MakeEntityCommand.js';
import { MakeEventCommand } from './commands/MakeEventCommand.js';
import { MakeFactoryCommand } from './commands/MakeFactoryCommand.js';
import { MakeInfraCommand } from './commands/MakeInfraCommand.js';
import { MakeJobCommand } from './commands/MakeJobCommand.js';
import { MakeListenerCommand } from './commands/MakeListenerCommand.js';
import { MakeMiddlewareCommand } from './commands/MakeMiddlewareCommand.js';
import { MakeMigrationCommand } from './commands/MakeMigrationCommand.js';
import { MakeModelCommand } from './commands/MakeModelCommand.js';
import { MakeObserverCommand } from './commands/MakeObserverCommand.js';
import { MakePluginCommand } from './commands/MakePluginCommand.js';
import { MakeProviderCommand } from './commands/MakeProviderCommand.js';
import { MakeRepositoryCommand } from './commands/MakeRepositoryCommand.js';
import { MakeRequestCommand } from './commands/MakeRequestCommand.js';
import { MakeResourceCommand } from './commands/MakeResourceCommand.js';
import { MakeRouteCommand } from './commands/MakeRouteCommand.js';
import { MakeSchemaCommand } from './commands/MakeSchemaCommand.js';
import { MakeSeederCommand } from './commands/MakeSeederCommand.js';
import { MakeServiceCommand } from './commands/MakeServiceCommand.js';
import { MakeTaskCommand } from './commands/MakeTaskCommand.js';
import { MakeTestCommand } from './commands/MakeTestCommand.js';
import { MigrateCommand } from './commands/MigrateCommand.js';
import { NewCommand } from './commands/NewCommand.js';
import { PluginInstallCommand } from './commands/PluginInstallCommand.js';
import { PluginListCommand } from './commands/PluginListCommand.js';
import { PluginPublishCommand } from './commands/PluginPublishCommand.js';
import { ProdDeployCommand } from './commands/ProdDeployCommand.js';
import { ProdDownCommand } from './commands/ProdDownCommand.js';
import { ProdLogsCommand } from './commands/ProdLogsCommand.js';
import { ProdRestartCommand } from './commands/ProdRestartCommand.js';
import { ProdUpCommand } from './commands/ProdUpCommand.js';
import { QueueFailedCommand } from './commands/QueueFailedCommand.js';
import { QueueFlushCommand } from './commands/QueueFlushCommand.js';
import { QueueRetryCommand } from './commands/QueueRetryCommand.js';
import { QueueWorkCommand } from './commands/QueueWorkCommand.js';
import { RoutesListCommand } from './commands/RoutesListCommand.js';
import { ScheduleRunCommand } from './commands/ScheduleRunCommand.js';
import { SearchSetupCommand } from './commands/SearchSetupCommand.js';
import { SeedCommand } from './commands/SeedCommand.js';
import { TinkerCommand } from './commands/TinkerCommand.js';
import { UpdateCommand } from './commands/UpdateCommand.js';

export type BuiltinCommandConstructor = new () => Command;

export const BUILTIN_COMMANDS: BuiltinCommandConstructor[] = [
  NewCommand,
  UpdateCommand,
  KeyGenerateCommand,
  MakeModelCommand,
  MakeEntityCommand,
  MakeMigrationCommand,
  MakeControllerCommand,
  MakeMiddlewareCommand,
  MakeProviderCommand,
  MakeSeederCommand,
  MakeServiceCommand,
  MakeRepositoryCommand,
  MakeActionCommand,
  MakeDtoCommand,
  MakeRequestCommand,
  MakeResourceCommand,
  MakeSchemaCommand,
  MakePluginCommand,
  MakeTaskCommand,
  MakeJobCommand,
  MakeCommandCommand,
  MakeConfigCommand,
  MakeChannelCommand,
  MakeDockerCommand,
  MakeCiCommand,
  MakeInfraCommand,
  InfraSetupCommand,
  MakeDeployCommand,
  MakeBroadcastingCommand,
  MakeDashboardCommand,
  MakeTestCommand,
  MakeFactoryCommand,
  MakeObserverCommand,
  MakeEventCommand,
  MakeListenerCommand,
  MakeRouteCommand,
  RoutesListCommand,
  MigrateCommand,
  SeedCommand,
  ScheduleRunCommand,
  QueueWorkCommand,
  QueueFailedCommand,
  QueueRetryCommand,
  QueueFlushCommand,
  SearchSetupCommand,
  TinkerCommand,
  PluginListCommand,
  PluginPublishCommand,
  PluginInstallCommand,
  DevUpCommand,
  DevDownCommand,
  DevLogsCommand,
  DevRestartCommand,
  ProdUpCommand,
  ProdDownCommand,
  ProdLogsCommand,
  ProdRestartCommand,
  ProdDeployCommand,
];

export function builtinCommandNames(): string[] {
  return BUILTIN_COMMANDS.map((CommandClass) => new CommandClass().name);
}
