/**
 * Svelar Core Migrations
 *
 * Framework-owned schema definitions. Runtime services should assume these
 * migrations have run instead of creating tables during request handling.
 */

import { Migration, type MigrationFile } from './Migration.js';

export class CreateSessionsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('sessions', (table) => {
      table.string('id').primary();
      table.text('payload');
      table.timestamp('expires_at');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('sessions');
  }
}

export class CreatePersonalAccessTokensTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('personal_access_tokens', (table) => {
      table.string('user_id');
      table.string('name');
      table.string('token');
      table.timestamp('created_at');
      table.index('token');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('personal_access_tokens');
  }
}

export class CreateRefreshTokensTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('refresh_tokens', (table) => {
      table.string('user_id');
      table.string('token').unique();
      table.timestamp('expires_at');
      table.timestamp('created_at');
      table.timestamp('revoked_at').nullable();
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('refresh_tokens');
  }
}

export class CreatePasswordResetsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('password_resets', (table) => {
      table.string('email');
      table.string('token');
      table.timestamp('expires_at');
      table.timestamp('created_at');
      table.index('email');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('password_resets');
  }
}

export class CreateEmailVerificationsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('email_verifications', (table) => {
      table.string('user_id');
      table.string('token');
      table.timestamp('expires_at');
      table.timestamp('created_at');
      table.index('user_id');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('email_verifications');
  }
}

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

export class CreateApiKeysTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('api_keys', (table) => {
      table.string('id').primary();
      table.string('user_id');
      table.string('name');
      table.string('key').unique();
      table.string('prefix');
      table.integer('last_used_at').nullable();
      table.integer('expires_at').nullable();
      table.text('permissions').nullable();
      table.text('metadata').nullable();
      table.integer('created_at');
      table.integer('revoked_at').nullable();
      table.index('user_id');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('api_keys');
  }
}

export class CreateAuditLogsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('audit_logs', (table) => {
      table.string('id').primary();
      table.string('user_id').nullable();
      table.string('action');
      table.string('model_type');
      table.string('model_id');
      table.text('old_values').nullable();
      table.text('new_values').nullable();
      table.text('metadata').nullable();
      table.string('ip_address').nullable();
      table.string('user_agent').nullable();
      table.integer('timestamp');
      table.index(['model_type', 'model_id']);
      table.index('user_id');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('audit_logs');
  }
}

export class CreateWebhooksTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('webhooks', (table) => {
      table.string('id').primary();
      table.string('user_id').nullable();
      table.text('url');
      table.text('events');
      table.string('secret');
      table.boolean('active');
      table.text('metadata').nullable();
      table.integer('created_at');
      table.index('user_id');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('webhooks');
  }
}

export class CreateWebhookDeliveriesTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('webhook_deliveries', (table) => {
      table.string('id').primary();
      table.string('webhook_id');
      table.string('event');
      table.text('payload');
      table.string('status');
      table.integer('status_code').nullable();
      table.text('response').nullable();
      table.integer('attempts');
      table.integer('max_attempts');
      table.integer('next_retry_at').nullable();
      table.integer('delivered_at').nullable();
      table.integer('created_at');
      table.index('webhook_id');
      table.index('status');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('webhook_deliveries');
  }
}

export class CreateSvelarUploadsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('svelar_uploads', (table) => {
      table.string('id').primary();
      table.string('user_id').nullable();
      table.text('original_name');
      table.text('stored_name');
      table.text('path');
      table.string('disk');
      table.string('mime_type');
      table.integer('size');
      table.text('public_url').nullable();
      table.text('metadata').nullable();
      table.integer('created_at');
      table.index('user_id');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('svelar_uploads');
  }
}

export class CreateEmailTemplatesTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('email_templates', (table) => {
      table.string('id').primary();
      table.string('name').unique();
      table.text('subject');
      table.text('html');
      table.text('text').nullable();
      table.text('variables');
      table.string('category').nullable();
      table.boolean('active');
      table.integer('created_at');
      table.integer('updated_at');
      table.index('category');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('email_templates');
  }
}

export class CreateNotificationsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('notifications', (table) => {
      table.string('id').primary();
      table.string('notifiable_id');
      table.string('type');
      table.text('data');
      table.timestamp('read_at').nullable();
      table.timestamp('created_at');
      table.index('notifiable_id');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('notifications');
  }
}

export class CreateTeamsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('teams', (table) => {
      table.string('id').primary();
      table.string('name');
      table.string('slug').unique();
      table.string('owner_id');
      table.boolean('personal_team');
      table.text('metadata').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.index('owner_id');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('teams');
  }
}

export class CreateTeamMembersTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('team_members', (table) => {
      table.string('id').primary();
      table.string('team_id');
      table.string('user_id');
      table.string('role');
      table.timestamp('joined_at');
      table.uniqueIndex(['team_id', 'user_id']);
      table.index('user_id');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('team_members');
  }
}

export class CreateTeamInvitationsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('team_invitations', (table) => {
      table.string('id').primary();
      table.string('team_id');
      table.string('email');
      table.string('role');
      table.string('token').unique();
      table.timestamp('expires_at');
      table.timestamp('accepted_at').nullable();
      table.timestamp('created_at');
      table.index('team_id');
      table.index('email');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('team_invitations');
  }
}

export class CreateFeatureFlagsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('feature_flags', (table) => {
      table.string('id').primary();
      table.string('name').unique();
      table.text('description');
      table.boolean('enabled');
      table.integer('percentage').nullable();
      table.text('metadata').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('feature_flags');
  }
}

export class CreateFeatureFlagOverridesTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('feature_flag_overrides', (table) => {
      table.string('id').primary();
      table.string('flag_name');
      table.string('scope_type');
      table.string('scope_id');
      table.boolean('enabled');
      table.timestamp('created_at');
      table.uniqueIndex(['flag_name', 'scope_type', 'scope_id']);
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('feature_flag_overrides');
  }
}

export class CreatePermissionsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('permissions', (table) => {
      table.increments('id');
      table.string('name');
      table.string('guard');
      table.text('description').nullable();
      table.timestamp('created_at').nullable();
      table.timestamp('updated_at').nullable();
      table.uniqueIndex(['name', 'guard']);
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('permissions');
  }
}

export class CreateRolesTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('roles', (table) => {
      table.increments('id');
      table.string('name');
      table.string('guard');
      table.text('description').nullable();
      table.timestamp('created_at').nullable();
      table.timestamp('updated_at').nullable();
      table.uniqueIndex(['name', 'guard']);
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('roles');
  }
}

export class CreateRoleHasPermissionsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('role_has_permissions', (table) => {
      table.integer('role_id');
      table.integer('permission_id');
      table.primary(['role_id', 'permission_id']);
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('role_has_permissions');
  }
}

export class CreateModelHasRolesTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('model_has_roles', (table) => {
      table.string('model_type');
      table.integer('model_id');
      table.integer('role_id');
      table.primary(['model_type', 'model_id', 'role_id']);
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('model_has_roles');
  }
}

export class CreateModelHasPermissionsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('model_has_permissions', (table) => {
      table.string('model_type');
      table.integer('model_id');
      table.integer('permission_id');
      table.primary(['model_type', 'model_id', 'permission_id']);
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('model_has_permissions');
  }
}

export class CreateSchedulerLocksTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('scheduler_locks', (table) => {
      table.string('task_key').primary();
      table.string('owner');
      table.timestamp('expires_at');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('scheduler_locks');
  }
}

export class CreateScheduledTaskRunsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('scheduled_task_runs', (table) => {
      table.increments('id');
      table.string('task');
      table.boolean('success');
      table.integer('duration');
      table.text('error').nullable();
      table.timestamp('ran_at');
      table.index('task');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('scheduled_task_runs');
  }
}

export class CreateSvelarJobsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('svelar_jobs', (table) => {
      table.string('id').primary();
      table.string('queue');
      table.text('payload');
      table.integer('attempts');
      table.integer('max_attempts');
      table.integer('reserved_at').nullable();
      table.integer('available_at');
      table.integer('created_at');
      table.index('queue');
      table.index('reserved_at');
      table.index('available_at');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('svelar_jobs');
  }
}

export class CreateSvelarFailedJobsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('svelar_failed_jobs', (table) => {
      table.string('id').primary();
      table.string('queue');
      table.string('job_class');
      table.text('payload');
      table.text('exception');
      table.integer('failed_at');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('svelar_failed_jobs');
  }
}

const coreMigrationDefinitions = [
  ['00000000_000001_create_sessions_table', CreateSessionsTable],
  ['00000000_000002_create_personal_access_tokens_table', CreatePersonalAccessTokensTable],
  ['00000000_000003_create_refresh_tokens_table', CreateRefreshTokensTable],
  ['00000000_000004_create_password_resets_table', CreatePasswordResetsTable],
  ['00000000_000005_create_email_verifications_table', CreateEmailVerificationsTable],
  ['00000000_000006_create_otp_codes_table', CreateOtpCodesTable],
  ['00000000_000007_create_api_keys_table', CreateApiKeysTable],
  ['00000000_000008_create_audit_logs_table', CreateAuditLogsTable],
  ['00000000_000009_create_webhooks_table', CreateWebhooksTable],
  ['00000000_000010_create_webhook_deliveries_table', CreateWebhookDeliveriesTable],
  ['00000000_000011_create_svelar_uploads_table', CreateSvelarUploadsTable],
  ['00000000_000012_create_email_templates_table', CreateEmailTemplatesTable],
  ['00000000_000013_create_notifications_table', CreateNotificationsTable],
  ['00000000_000014_create_teams_table', CreateTeamsTable],
  ['00000000_000015_create_team_members_table', CreateTeamMembersTable],
  ['00000000_000016_create_team_invitations_table', CreateTeamInvitationsTable],
  ['00000000_000017_create_feature_flags_table', CreateFeatureFlagsTable],
  ['00000000_000018_create_feature_flag_overrides_table', CreateFeatureFlagOverridesTable],
  ['00000000_000019_create_permissions_table', CreatePermissionsTable],
  ['00000000_000020_create_roles_table', CreateRolesTable],
  ['00000000_000021_create_role_has_permissions_table', CreateRoleHasPermissionsTable],
  ['00000000_000022_create_model_has_roles_table', CreateModelHasRolesTable],
  ['00000000_000023_create_model_has_permissions_table', CreateModelHasPermissionsTable],
  ['00000000_000024_create_scheduler_locks_table', CreateSchedulerLocksTable],
  ['00000000_000025_create_scheduled_task_runs_table', CreateScheduledTaskRunsTable],
  ['00000000_000026_create_svelar_jobs_table', CreateSvelarJobsTable],
  ['00000000_000027_create_svelar_failed_jobs_table', CreateSvelarFailedJobsTable],
] as const;

export function svelarCoreMigrations(): MigrationFile[] {
  return coreMigrationDefinitions.map(([name, MigrationClass]) => ({
    name,
    timestamp: name.split('_').slice(0, 2).join('_'),
    path: `@beeblock/svelar/database/core/${name}`,
    migration: new MigrationClass(),
  }));
}
