import { Job } from 'svelar/queue';
import { User } from '../models/User.js';
import { Post } from '../models/Post.js';

/**
 * Export data job — generates a CSV export of posts and saves to storage.
 * Demonstrates handling large datasets and file generation.
 */
export class ExportDataJob extends Job {
  maxAttempts = 2;
  retryDelay = 120;

  declare userId: number;
  declare format: 'csv' | 'json';

  constructor(userId?: number, format: 'csv' | 'json' = 'csv') {
    super();
    this.userId = userId ?? 0;
    this.format = format;
  }

  async handle(): Promise<void> {
    if (!this.userId) {
      throw new Error('User ID is required for export');
    }

    console.log(`[ExportDataJob] Exporting data for user #${this.userId}`);

    try {
      const user = await User.find(this.userId);
      if (!user) {
        throw new Error(`User #${this.userId} not found`);
      }

      if (this.format === 'csv') {
        await this.generateCsvExport(user);
      } else {
        await this.generateJsonExport(user);
      }

      // In a real app, you would:
      // 1. Save file to storage (S3, local, etc)
      // 2. Send download link via email
      // 3. Store export record in database

      console.log(
        `[ExportDataJob] Export generated successfully for user #${this.userId}`
      );
    } catch (error) {
      throw new Error(
        `Failed to export data: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  private async generateCsvExport(user: User): Promise<void> {
    const posts = await user.posts();

    const csv = [
      'ID,Title,Body,Published,Created At',
      ...posts.map(
        (post) =>
          `${post.id},"${post.title}","${post.body.replace(/"/g, '""')}",${post.published},${post.created_at}`
      ),
    ].join('\n');

    console.log(`[ExportDataJob] Generated CSV with ${posts.length} posts`);
    // In real app: await storage.put(`exports/user-${user.id}-${Date.now()}.csv`, csv);
  }

  private async generateJsonExport(user: User): Promise<void> {
    const posts = await user.posts();

    const json = {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        created_at: user.created_at,
      },
      posts: posts.map((post) => ({
        id: post.id,
        title: post.title,
        body: post.body,
        published: post.published,
        created_at: post.created_at,
      })),
    };

    console.log(`[ExportDataJob] Generated JSON with ${posts.length} posts`);
    // In real app: await storage.put(`exports/user-${user.id}-${Date.now()}.json`, JSON.stringify(json, null, 2));
  }

  failed(error: Error): void {
    console.error(
      `[ExportDataJob] Failed to export data for user #${this.userId}:`,
      error.message
    );
  }

  serialize(): Record<string, unknown> {
    return { userId: this.userId, format: this.format };
  }

  static restore(data: Record<string, unknown>): ExportDataJob {
    return new ExportDataJob(
      data.userId as number,
      (data.format as 'csv' | 'json') ?? 'csv'
    );
  }
}
