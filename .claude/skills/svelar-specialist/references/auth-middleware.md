# Authentication, Authorization And Validation

Read [authentication](../../../../docs/06-authentication.md), [middleware](../../../../docs/07-middleware.md), [permissions](../../../../docs/49-permissions.md), [sessions](../../../../docs/22-sessions.md) and [shared validation](../../../../docs/05-validation-dtos.md). Outside this repo, use the corresponding https://svelar.dev/docs pages.

## Authentication

Use a configured AuthManager, forked per request by middleware. Identity comes from the configured model primaryKey and auth.id(), never an untrusted shadow id. Integer/UUID/ULID/custom keys require matching app-owned token/membership/plugin foreign-key migrations; changing the model alone does not migrate storage.

Apply configured eligibility to password, persisted session, JWT, refresh, user-bound API token, OTP and federation paths. Disabled, locked or unverified accounts fail closed. Federation callbacks prove provider/state and secure linking before auth.login; never write auth_user_id directly. Current Auth APIs audit attempts, so templates must not duplicate credential events or log passwords/tokens.

API/service credentials carry current capability ceilings and trusted tenant/actor context. Invalid Bearer credentials cannot fall back to cookies, and a supplied Bearer header alone does not waive origin/CSRF checks. Independently signed webhook routes do not borrow a browser identity.

JWT refresh tokens rotate with replay protection; session renewal uses idle/absolute/remember policy, not a separate browser refresh-token fiction. Status polling/multitab messages do not extend sessions. Preserve server-validated protected return paths across login/register/recovery/OTP links.

## Authorization

FormRequest.authorize is request-level permission; policies/gates evaluate model decisions. Register literal capability manifests and sync catalogs/profiles with seeders. Creating a permission name in a UI does not create a backend gate.

Platform ownership is current trusted persisted identity, not a tenant role named admin. Resolve explicit team scope after membership authorization. System profiles are defaults minus exclusions plus inclusions; custom profiles are exact. Client capability snapshots only drive presentation and cannot grant access.

Verify backend guards before parsing write payloads and again at the domain boundary where required. Return 401/403 envelopes with usable inline/toast feedback instead of throwing generic 500s.

## Shared Validation

Use both FormRequest and DTO. The selected shared schema is the single frontend/backend source of truth. Zod apps use zod4/zod4Client and Valibot apps use valibot/valibotClient. Svelar's mapped validation rules target both providers; do not maintain a separate browser schema.

Keep real Superforms bindings, novalidate, inline errors/aria-invalid, pending state, password clearing and no duplicate validation toasts. Server failure messages never replace field-level validation. Avoid legacy controller-only validate/create examples for new write flows.
