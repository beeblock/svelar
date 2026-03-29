import { ScheduledTask } from 'svelar/scheduler';

/**
 * Broadcast a toast notification to all connected SSE clients every minute.
 *
 * When running in-process (e.g. "Run Now" from admin dashboard), uses the
 * Broadcast singleton directly. When running from the CLI scheduler process,
 * falls back to the internal HTTP bridge.
 */
export default class BroadcastNotification extends ScheduledTask {
  name = 'broadcast-notification';

  schedule() {
    return this.everyMinute();
  }

  async handle(): Promise<void> {
    const channel = 'notifications';
    const eventName = 'toast';
    const data = {
      variant: 'info',
      title: 'Scheduled Update',
      description: `System check completed at ${new Date().toLocaleTimeString()}`,
    };

    // Try direct broadcast first (works when running in the web server process)
    try {
      const { Broadcast } = await import('svelar/broadcasting');
      if (Broadcast.totalSubscribers() > 0) {
        await Broadcast.to(channel).send(eventName, data);
        return;
      }
    } catch {
      // Not in web server context — fall through to HTTP bridge
    }

    // HTTP bridge for CLI scheduler process
    const baseUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
    const secret = process.env.INTERNAL_SECRET || 'svelar-internal-secret';

    try {
      const res = await fetch(`${baseUrl}/api/internal/broadcast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': secret,
        },
        body: JSON.stringify({ channel, eventName, data }),
      });

      if (!res.ok) {
        throw new Error(`Broadcast failed (${res.status})`);
      }

    } catch (err: any) {
      if (err?.cause?.code === 'ECONNREFUSED') {
        return;
      }
      throw err;
    }
  }
}
