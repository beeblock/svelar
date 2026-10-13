import { QueryBuilder } from '../../orm/QueryBuilder.js';
import { Migration } from '../Migration.js';

export class AddApiKeyRotationState extends Migration {
  async up(): Promise<void> {
    await this.schema.table('api_keys', (table) => {
      table.string('rotation_id').nullable();
      table.bigInteger('rotated_at').nullable();
      table.bigInteger('overlap_until').nullable();
      table.index('rotation_id', 'idx_api_keys_rotation_id');
    });
    await new QueryBuilder<{ id: string }>('api_keys').select('id').chunkById(500, async (rows) => {
      for (const row of rows) await new QueryBuilder('api_keys').where('id', row.id).update({ rotation_id: row.id });
    });
  }

  async down(): Promise<void> {
    const overlap = await new QueryBuilder('api_keys').whereNotNull('overlap_until').where('overlap_until', '>', Date.now()).first();
    if (overlap) throw new Error('Cannot remove API key rotation state while an overlap window is active. Revoke the credential or wait for the window to expire.');
    await this.schema.table('api_keys', (table) => {
      table.dropIndex('idx_api_keys_rotation_id');
      table.dropColumn('overlap_until');
      table.dropColumn('rotated_at');
      table.dropColumn('rotation_id');
    });
  }
}
