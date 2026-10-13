import { ScheduleRunCommand } from './ScheduleRunCommand.js';

export class ScheduleWorkCommand extends ScheduleRunCommand {
  name = 'schedule:work';
  description = 'Run the scheduler worker with durable requests and graceful drain';
}
