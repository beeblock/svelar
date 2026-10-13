/**
 * Svelar Core Migrations
 *
 * Framework-owned schema definitions. Runtime services should assume these
 * migrations have run instead of creating tables during request handling.
 */

import type { MigrationFile } from './Migration.js';
import { CreateSessionsTable } from './core/00000000_000001_create_sessions_table.js';
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
import { CreateScheduledTaskSettingsTable } from './core/00000000_000028_create_scheduled_task_settings_table.js';
import { CreateWebhookInboxEntriesTable } from './core/00000000_000029_create_webhook_inbox_entries_table.js';
import { AddServiceAccountFieldsToApiKeysTable } from './core/00000000_000030_add_service_account_fields_to_api_keys_table.js';
import { CreateTeamRoleHasPermissionsTable } from './core/00000000_000031_create_team_role_has_permissions_table.js';
import { CreateTeamModelHasRolesTable } from './core/00000000_000032_create_team_model_has_roles_table.js';
import { CreateTeamModelHasPermissionsTable } from './core/00000000_000033_create_team_model_has_permissions_table.js';
import { ScopeWebhookInboxIdempotency } from './core/00000000_000034_scope_webhook_inbox_idempotency.js';
import { CreateSvelarLogsTable } from './core/00000000_000035_create_svelar_logs_table.js';
import { CreateSearchOutboxTable } from './core/00000000_000036_create_search_outbox_table.js';
import { AddWebhookInboxProcessing } from './core/00000000_000037_add_webhook_inbox_processing.js';
import { AddQueueJobLeases } from './core/00000000_000038_add_queue_job_leases.js';
import { AddFailedQueueReplay } from './core/00000000_000039_add_failed_queue_replay.js';
import { CreateRoleCapabilityProfilesTable } from './core/00000000_000040_create_role_capability_profiles_table.js';
import { CreateTeamRoleCapabilityProfilesTable } from './core/00000000_000041_create_team_role_capability_profiles_table.js';
import { CreateQueueEventsTable } from './core/00000000_000043_create_queue_events_table.js';
import { AddApiKeyRotationState } from './core/00000000_000045_add_api_key_rotation_state.js';
import { CreateBackgroundOperationsTable } from './core/00000000_000046_create_background_operations_table.js';
import { AddSchedulerSettingsPolicy } from './core/00000000_000044_add_scheduler_settings_policy.js';
import { CreateSchedulerRuntimeTable } from './core/00000000_000047_create_scheduler_runtime_table.js';
import { CreateSchedulerRequestsTable } from './core/00000000_000048_create_scheduler_requests_table.js';
import { CreateDeploymentLocksTable } from './core/00000000_000049_create_deployment_locks_table.js';

export {
  CreateSessionsTable,
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
  CreateScheduledTaskSettingsTable,
  CreateWebhookInboxEntriesTable,
  AddServiceAccountFieldsToApiKeysTable,
  CreateTeamRoleHasPermissionsTable,
  CreateTeamModelHasRolesTable,
  CreateTeamModelHasPermissionsTable,
  ScopeWebhookInboxIdempotency,
  CreateSvelarLogsTable,
  CreateSearchOutboxTable,
  AddWebhookInboxProcessing,
  AddQueueJobLeases,
  AddFailedQueueReplay,
  CreateRoleCapabilityProfilesTable,
  CreateTeamRoleCapabilityProfilesTable,
  CreateQueueEventsTable,
  AddApiKeyRotationState,
  CreateBackgroundOperationsTable,
  AddSchedulerSettingsPolicy,
  CreateSchedulerRuntimeTable,
  CreateSchedulerRequestsTable,
  CreateDeploymentLocksTable,
};

const coreMigrationDefinitions = [
  ['00000000_000001_create_sessions_table', CreateSessionsTable],
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
  ['00000000_000028_create_scheduled_task_settings_table', CreateScheduledTaskSettingsTable],
  ['00000000_000029_create_webhook_inbox_entries_table', CreateWebhookInboxEntriesTable],
  ['00000000_000030_add_service_account_fields_to_api_keys_table', AddServiceAccountFieldsToApiKeysTable],
  ['00000000_000031_create_team_role_has_permissions_table', CreateTeamRoleHasPermissionsTable],
  ['00000000_000032_create_team_model_has_roles_table', CreateTeamModelHasRolesTable],
  ['00000000_000033_create_team_model_has_permissions_table', CreateTeamModelHasPermissionsTable],
  ['00000000_000034_scope_webhook_inbox_idempotency', ScopeWebhookInboxIdempotency],
  ['00000000_000035_create_svelar_logs_table', CreateSvelarLogsTable],
  ['00000000_000036_create_search_outbox_table', CreateSearchOutboxTable],
  ['00000000_000037_add_webhook_inbox_processing', AddWebhookInboxProcessing],
  ['00000000_000038_add_queue_job_leases', AddQueueJobLeases],
  ['00000000_000039_add_failed_queue_replay', AddFailedQueueReplay],
  ['00000000_000040_create_role_capability_profiles_table', CreateRoleCapabilityProfilesTable],
  ['00000000_000041_create_team_role_capability_profiles_table', CreateTeamRoleCapabilityProfilesTable],
  ['00000000_000043_create_queue_events_table', CreateQueueEventsTable],
  ['00000000_000044_add_scheduler_settings_policy', AddSchedulerSettingsPolicy],
  ['00000000_000045_add_api_key_rotation_state', AddApiKeyRotationState],
  ['00000000_000046_create_background_operations_table', CreateBackgroundOperationsTable],
  ['00000000_000047_create_scheduler_runtime_table', CreateSchedulerRuntimeTable],
  ['00000000_000048_create_scheduler_requests_table', CreateSchedulerRequestsTable],
  ['00000000_000049_create_deployment_locks_table', CreateDeploymentLocksTable],
] as const;

export function svelarCoreMigrations(): MigrationFile[] {
  return coreMigrationDefinitions.map(([name, MigrationClass]) => ({
    name,
    timestamp: name.split('_').slice(0, 2).join('_'),
    path: `@beeblock/svelar/database/core/${name}`,
    migration: new MigrationClass(),
  }));
}
