import { Migration } from '../Migration.js';

export class CreateOtpCodesTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('otp_codes', (table) => {
      table.string('email');
      table.string('code');
      table.string('purpose');
      table.timestamp('expires_at');
      table.timestamp('created_at');
      table.timestamp('used_at').nullable();
      table.index(['email', 'purpose']);
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('otp_codes');
  }
}
