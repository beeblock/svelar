import { Job } from 'svelar/queue';
import { User } from '../models/User.js';
import { Post } from '../models/Post.js';

/**
 * Daily digest job — generates a summary of posts from the last 24 hours
 * and would send it to all active users (in a real app).
 * Demonstrates job serialization and async operations.
 */
export class DailyDigestJob extends Job {
  maxAttempts = 3;
  retryDelay = 60;

  declare date: string;

  constructor(date?: string) {
    super();
    this.date = date ?? new Date().toISOString().split('T')[0];
  }

  async handle(): Promise<void> {
    console.log(`[DailyDigestJob] Generating digest for ${this.date}`);

    try {
      // In a real app, you would:
      // 1. Fetch users subscribed to digest
      // 2. Fetch posts from last 24 hours
      // 3. Generate HTML digest
      // 4. Send via mailer to each user

      const userCount = await User.count();
      const postCount = await Post.count();

      console.log(
        `[DailyDigestJob] Summary: ${userCount} users, ${postCount} posts`
      );

      // Simulate async work
      await new Promise((resolve) => setTimeout(resolve, 100));

      console.log(`[DailyDigestJob] Digest generated successfully`);
    } catch (error) {
      throw new Error(
        `Failed to generate digest: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  failed(error: Error): void {
    console.error(
      `[DailyDigestJob] Failed to generate digest for ${this.date}:`,
      error.message
    );
  }

  /**
   * Serialize job data for storage in queue
   */
  serialize(): Record<string, unknown> {
    return { date: this.date };
  }

  /**
   * Restore job from stored data
   */
  static restore(data: Record<string, unknown>): DailyDigestJob {
    return new DailyDigestJob(data.date as string);
  }
}
