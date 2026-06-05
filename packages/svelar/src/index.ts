/**
 * Svelar — Laravel-inspired framework on top of SvelteKit 2
 *
 * @module @beeblock/svelar
 */

// ORM
export { Model, type ModelAttributes, type ModelHooks } from './orm/Model.js';
export { QueryBuilder } from './orm/QueryBuilder.js';
export { HasOne, HasMany, BelongsTo, BelongsToMany } from './orm/Relationship.js';

// Database
export {
  Connection,
  normalizeDatabaseDriver,
  type DatabaseConfig,
  type DatabaseDriver,
  type DatabaseDriverAlias,
  type ConnectionsConfig,
} from './database/Connection.js';
export { Schema, schema, TableBuilder, ColumnBuilder } from './database/SchemaBuilder.js';
export { Migration, Migrator } from './database/Migration.js';
export * from './database/CoreMigrations.js';
export { Seeder } from './database/Seeder.js';

// Container & Providers
export { Container, container } from './container/Container.js';
export { ServiceProvider } from './container/ServiceProvider.js';
export { Application } from './container/Application.js';

// Middleware
export { Middleware, MiddlewareStack, CorsMiddleware, RateLimitMiddleware, LoggingMiddleware, CsrfMiddleware, OriginMiddleware, ThrottleMiddleware, SignatureMiddleware } from './middleware/Middleware.js';
export type { MiddlewareContext, NextFunction, MiddlewareHandler, CorsOptions, RateLimitOptions, LoggingOptions, CsrfOptions, ThrottleOptions } from './middleware/Middleware.js';

// Routing & Controllers
export { Controller, resource, ValidationError, NotFoundError, UnauthorizedError, ForbiddenError } from './routing/Controller.js';
export type { RequestEvent } from './routing/Controller.js';

// Hooks
export { createSvelarHooks, sequence } from './hooks/index.js';

// Config
export { config, env } from './config/Config.js';

// Validation
export { z, rules, validate } from './validation/index.js';

// Auth
export { AuthManager, AuthenticateMiddleware, RequireAuthMiddleware, signJwt, verifyJwt } from './auth/Auth.js';
export type { AuthConfig, AuthUser, GuardType, JwtConfig, JwtPayload } from './auth/Auth.js';

// Hashing
export { Hash } from './hashing/Hash.js';
export type { HashDriver, HashConfig } from './hashing/Hash.js';

// Session
export { Session, SessionMiddleware, MemorySessionStore, DatabaseSessionStore, FileSessionStore, RedisSessionStore } from './session/Session.js';
export type { SessionStore, SessionConfig, SessionData } from './session/Session.js';

// Errors
export { ErrorHandler, HttpError, abort, abortIf, abortUnless, ModelNotFoundError } from './errors/Handler.js';
export type { ErrorHandlerConfig } from './errors/Handler.js';

// Events
export { Event, EventDispatcher } from './events/index.js';
export type { EventClass, EventListener, Subscriber } from './events/index.js';

// Form Requests
export { FormRequest, FormValidationError, FormAuthorizationError } from './routing/FormRequest.js';

// Storage
export { Storage } from './storage/index.js';
export type { StorageConfig, DiskConfig, FileInfo } from './storage/index.js';

// Logging
export { Log } from './logging/index.js';
export type { LogLevel, LogConfig, LogChannelConfig } from './logging/index.js';
export { LogViewer } from './logging/LogViewer.js';
export type { LogEntry, LogFilter, LogStats } from './logging/LogViewer.js';

// Cache
export { Cache } from './cache/index.js';
export type { CacheConfig, CacheStoreConfig, CacheDriver } from './cache/index.js';

// Queue
export { Queue, Job } from './queue/index.js';
export type { QueueConfig, DispatchOptions } from './queue/index.js';
export { JobMonitor } from './queue/JobMonitor.js';
export type { JobInfo, JobCounts, JobFilter, QueueHealth } from './queue/JobMonitor.js';

// Mail
export { Mailer, Mailable } from './mail/index.js';
export type { MailerConfig, MailMessage, SendResult } from './mail/index.js';

// Email Templates
export { EmailTemplates, EmailTemplate } from './email-templates/index.js';
export type { EmailTemplate as EmailTemplateRecord, RenderResult, TemplateConfig } from './email-templates/index.js';

// API Keys
export { ApiKeys } from './api-keys/index.js';
export type { ApiKeyRecord, CreateKeyOptions, ApiKeyConfig } from './api-keys/index.js';

// Audit
export { Audit, auditable } from './audit/index.js';
export type { AuditEntry, AuditFilter, AuditDriver, AuditConfig } from './audit/index.js';

// Notifications
export { Notifier, Notification } from './notifications/index.js';
export type { Notifiable, NotificationChannel } from './notifications/index.js';

// Broadcasting
export { Broadcast } from './broadcasting/index.js';
export type { BroadcastConfig, BroadcastEvent, ChannelAuthCallback, PresenceMember, ChannelType } from './broadcasting/index.js';

// Dashboard
export { Dashboard, configureDashboard } from './dashboard/index.js';
export type { DashboardConfig, SystemHealth } from './dashboard/index.js';

// Feature Flags
export { Features } from './feature-flags/index.js';
export type { FeatureFlag, FeatureFlagOverride, FeatureFlagsConfig, FeatureFlagDefinition } from './feature-flags/index.js';

// Permissions
export { Permissions, HasRoles, RequirePermissionMiddleware, RequireRoleMiddleware } from './permissions/index.js';
export type { PermissionRecord, RoleRecord, HasRolesInstance } from './permissions/index.js';

// Search
export { Search, Searchable } from './search/index.js';
export type { SearchConfig, SearchHit, SearchResults, SearchOptions, SearchableInstance } from './search/index.js';

// Scheduler
export { Scheduler, ScheduledTask, task, SchedulerLock, parseCron, cronMatches } from './scheduler/index.js';
export type { TaskSchedule, TaskResult } from './scheduler/index.js';
export { ScheduleMonitor } from './scheduler/ScheduleMonitor.js';
export type { TaskRunRecord, TaskInfo, SchedulerHealth } from './scheduler/ScheduleMonitor.js';

// Teams
export { Teams } from './teams/index.js';
export type { Team, TeamMember, TeamInvitation, TeamRole, TeamsConfig } from './teams/index.js';

// Uploads
export { Uploads } from './uploads/index.js';
export type { FileUpload, UploadOptions, UploadsConfig } from './uploads/index.js';

// Webhooks
export { Webhooks } from './webhooks/index.js';
export type { WebhookEndpoint, WebhookDelivery, WebhookConfig } from './webhooks/index.js';

// PDF
export { PDF, GeneratePdfJob } from './pdf/index.js';
export type { PdfConfig, GotenbergConfig, PdfKitConfig, WebhookOptions, PdfJobPayload } from './pdf/index.js';

// Excel
export { Excel, Spreadsheet, SheetBuilder } from './excel/index.js';
export type { ColumnDef, SheetDef, ExportOptions, ImportOptions, ImportStreamOptions } from './excel/index.js';

// HTTP (client-side utilities)
export { apiFetch, getCsrfToken, buildUrl, registerToast, Http, HttpClient, HttpRequestError } from './http/index.js';
export type { ApiFetchOptions, ApiResponse, ApiError, HttpClientResponse, HttpClientConfig } from './http/index.js';

// i18n
export { createI18nHandle, createReroute } from './i18n/index.js';
export type { I18nHandleConfig, RerouteConfig } from './i18n/index.js';

// Forms
export { createFormAction, loadForm, validateForm } from './forms/index.js';
export type { FormActionOptions } from './forms/index.js';

// Plugins
export { Plugin, PluginManager, discoverPlugins } from './plugins/index.js';
export { PluginRegistry } from './plugins/PluginRegistry.js';
export { PluginPublisher } from './plugins/PluginPublisher.js';
export { PluginInstaller } from './plugins/PluginInstaller.js';
export type { PluginConfig, PluginMigration, PluginRoute, PluginCommand, PluginHook } from './plugins/index.js';
export type { PluginMeta } from './plugins/PluginRegistry.js';
export type { PublishResult, PublishableFile } from './plugins/PluginPublisher.js';
export type { InstallResult } from './plugins/PluginInstaller.js';

// Date helpers
export {
  toDate,
  parseLocalDate,
  toLocal,
  formatDate,
  formatRelative,
  formatShortRelative,
  formatBetween,
  timeAgo,
  castDates,
  dateCaster,
  isToday,
  isYesterday,
  isTomorrow,
  isValid,
  parseISO,
  format,
} from './support/date.js';
export type { DateInput, FormatOptions, Locale } from './support/date.js';

// App (simplified hooks setup)
export { createSvelarApp } from './hooks/index.js';
export type { SvelarAppConfig } from './hooks/index.js';
