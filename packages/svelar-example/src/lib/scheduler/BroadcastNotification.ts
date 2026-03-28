import { ScheduledTask } from 'svelar/scheduler';

/**
 * Broadcast a toast notification to all connected SSE clients every minute.
 * Uses the internal HTTP bridge to reach the web server's SSE channels.
 */
export default class BroadcastNotification extends ScheduledTask {
  name = 'broadcast-notification';

  schedule() {
    return this.everyMinute();
  }

  async handle(): Promise<void> {
    const baseUrl = process.env.APP_URL || 'http://localhost:5179';
    const secret = process.env.INTERNAL_SECRET || 'svelar-internal-secret';

    const res = await fetch(`${baseUrl}/api/internal/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify({
        channel: 'notifications',
        eventName: 'toast',
        data: {
          variant: 'info',
          title: 'Scheduled Update',
          description: `System check completed at ${new Date().toLocaleTimeString()}`,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Broadcast failed (${res.status}): ${body}`);
    }

    console.log('[Scheduler] Broadcast notification sent');
  }
}
