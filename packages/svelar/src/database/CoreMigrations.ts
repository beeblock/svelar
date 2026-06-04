/**
 * Svelar Core Migrations
 *
 * Framework-owned schema definitions. Runtime services should assume these
 * migrations have run instead of creating tables during request handling.
 */

import type { MigrationFile } from './Migration.js';
import { CreateSessionsTable } from './core/00000000_000001_create_sessions_table.js';
import { CreatePersonalAccessTokensTable } from './core/00000000_000002_create_personal_access_tokens_table.js';
import { CreateRefreshTokensTable } from './core/00000000_000003_create_refresh_tokens_table.js';
import { CreatePasswordResetsTable } from './core/00000000_000004_create_password_resets_table.js';
import { CreateEmailVerificationsTable } from './core/00000000_000005_create_email_verifications_table.js';
import { CreateOtpCodesTable } from './core/00000000_000006_create_otp_codes_table.js';
import { CreateApiKeysTable } from './core/00000000_000007_create_api_keys_table.js';
import { CreateAuditLogsTable } from './core/00000000_000008_create_audit_logs_table.js';
import { CreateWebhooksTable } from './core/00000000_000009_create_webhooks_table.js';
import { CreateWebhookDeliveriesTable } from './core/00000000_000010_create_webhook_deliveries_table.js';
import { CreateSvelarUploadsTable } from './core/00000000_000011_create_svelar_uploads_table.js';
import { CreateEmailTemplatesTable } from './core/00000000_000012_create_email_templates_table.js';
import { CreateNotificationsTable } from './core/00000000_000013_create_notifications_table.js';
import { CreateTeamsTable } from './core/00000000_000014_create_teams_table.js';
import { CreateTeamMembersTable } from './core/00000000_000015_create_team_members_table.js';
import { CreateTeamInvitationsTable } from './core/00000000_000016_create_team_invitations_table.js';
import { CreateFeatureFlagsTable } from './core/00000000_000017_create_feature_flags_table.js';
import { CreateFeatureFlagOverridesTable } from './core/00000000_000018_create_feature_flag_overrides_table.js';
import { CreatePermissionsTable } from './core/00000000_000019_create_permissions_table.js';
import { CreateRolesTable } from './core/00000000_000020_create_roles_table.js';
import { CreateRoleHasPermissionsTable } from './core/00000000_000021_create_role_has_permissions_table.js';
import { CreateModelHasRolesTable } from './core/00000000_000022_create_model_has_roles_table.js';
import { CreateModelHasPermissionsTable } from './core/00000000_000023_create_model_has_permissions_table.js';
import { CreateSchedulerLocksTable } from './core/00000000_000024_create_scheduler_locks_table.js';
import { CreateScheduledTaskRunsTable } from './core/00000000_000025_create_scheduled_task_runs_table.js';
import { CreateSvelarJobsTable } from './core/00000000_000026_create_svelar_jobs_table.js';
import { CreateSvelarFailedJobsTable } from './core/00000000_000027_create_svelar_failed_jobs_table.js';

export {
  CreateSessionsTable,
  CreatePersonalAccessTokensTable,
  CreateRefreshTokensTable,
  CreatePasswordResetsTable,
  CreateEmailVerificationsTable,
  CreateOtpCodesTable,
  CreateApiKeysTable,
  CreateAuditLogsTable,
  CreateWebhooksTable,
  CreateWebhookDeliveriesTable,
  CreateSvelarUploadsTable,
  CreateEmailTemplatesTable,
  CreateNotificationsTable,
  CreateTeamsTable,
  CreateTeamMembersTable,
  CreateTeamInvitationsTable,
  CreateFeatureFlagsTable,
  CreateFeatureFlagOverridesTable,
  CreatePermissionsTable,
  CreateRolesTable,
  CreateRoleHasPermissionsTable,
  CreateModelHasRolesTable,
  CreateModelHasPermissionsTable,
  CreateSchedulerLocksTable,
  CreateScheduledTaskRunsTable,
  CreateSvelarJobsTable,
  CreateSvelarFailedJobsTable,
};

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
