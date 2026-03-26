import { Job } from 'svelar/queue';

/**
 * Example queued job — sends a welcome email after registration.
 * Demonstrates the job/queue system.
 */
export class SendWelcomeEmail extends Job {
  maxAttempts = 3;
  retryDelay = 30;

  constructor(private userId: number, private email: string) {
    super();
  }

  async handle(): Promise<void> {
    console.log(`[Job] Sending welcome email to ${this.email} (user #${this.userId})`);
    // In production:
    // const { Mailer } = await import('svelar/mail');
    // await Mailer.send({
    //   to: this.email,
    //   subject: 'Welcome to Svelar!',
    //   html: '<h1>Welcome!</h1><p>Thanks for signing up.</p>',
    // });
  }

  failed(error: Error): void {
    console.error(`[Job] Failed to send welcome email to ${this.email}:`, error.message);
  }
}
