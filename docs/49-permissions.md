# Permissions & Capabilities

Use a single server-owned `PermissionManifest` for screen access, individual commands, navigation and the role editor. Functional RBAC is checked before parsing a write request; resource policies and FormRequest authorization still decide whether this user may change this particular record.

## Declare The Contract

```typescript
import { PermissionManifest } from '@beeblock/svelar/permissions';

export const permissionDefinition = {
  screens: [
    { resource: 'boards', label: 'Boards', group: 'Work', route: '/boards', scope: 'team' as const },
    { resource: 'platform', label: 'Platform console', group: 'System', route: '/admin', scope: 'platform' as const },
  ],
  actions: [
    { screen: 'boards', action: 'create', label: 'Create a board' },
    { screen: 'boards', action: 'edit', label: 'Edit a board' },
    { screen: 'boards', action: 'delete', label: 'Delete a board' },
    { screen: 'boards', action: 'publish', label: 'Publish a board' },
    { screen: 'boards', action: 'pause', label: 'Pause a board' },
    { screen: 'boards', action: 'export', label: 'Export a board' },
  ],
  systemProfiles: [
    { name: 'board-reader', label: 'Reader', scope: 'team' as const, defaults: ['screen.boards.view'] },
    { name: 'product-admin', label: 'Product administrator', scope: 'team' as const, defaults: 'all' as const },
  ],
};
export const permissionManifest = new PermissionManifest(permissionDefinition);
```

Screen names derive as `screen.<resource>.view`; action names derive as `action.<resource>.<action>`. Every action depends on its screen automatically. Add `dependencies` for additional explicitly declared capabilities. Unknown dependencies, cycles, duplicate routes and cross-scope dependencies fail at construction. Each command is granted independently: publishing does not imply deletion or export.

DDD manifests live at `src/lib/shared/permissions/manifest.ts`, with module fragments in `contracts/capabilities.ts`. Flat apps use `src/lib/permissions/manifest.ts` and `permissions/capabilities/<module>.ts`. Keep definitions as editable exported literal data so the generators and architectural lint can inspect them without running application code.

## Generate Protected Flows

```bash
npx svelar make:entity Board --module=boards --fields="title:string" --crud --capability=boards --scope=team --screen-route=/boards
npx svelar make:controller BoardController --module=boards --capability=boards --scope=team --screen-route=/boards
npx svelar make:route boards --api --resource --controller=BoardController --module=boards --capability=boards --scope=team --screen-route=/boards
npx svelar make:dashboard --capability=operations --scope=platform
npx svelar lint:architecture --json
```

These generators require an explicit `--capability=<resource>` or `--public` decision before writing artifacts. `make:route` also accepts `--permission=<existing canonical capability>` for a custom non-resource endpoint. `make:model --all`, `--controller` and `--resource` forward the same decision. `--public` exempts functional RBAC only: it does not remove authentication, resource policies, shared validation or CSRF.

The protected scaffold extends the central manifest, creates a trusted principal resolver and a capability seeder, and guards controller/endpoint execution before FormRequest parsing. Missing static capabilities or unguarded route writes fail architectural lint. Dynamic decisions require explicit review rather than silently enabling a whole module. Existing customized resolvers and seeders are not overwritten automatically.

## Seed Catalogs And Profiles

```typescript
import { Permissions, PermissionProfiles } from '@beeblock/svelar/permissions';

Permissions.registerManifest(permissionManifest);
await Permissions.syncCapabilities();
const role = await Permissions.createRole({ name: 'editor', guard: 'web' });
const profiles = new PermissionProfiles(permissionManifest);
await profiles.forTeam(teamId).setCustom(role.id, ['screen.boards.view', 'action.boards.edit']);
await Permissions.forTeam(teamId).assignRole('User', userId, role.id);
```

Run this in a seeder after the permission/profile migrations. The generated `CapabilitySeeder` creates the catalog and system profile roles through public APIs but assigns no users. Initial assignments belong in authorized application provisioning or seeders, not controllers or UI constants.

System profiles are `defaults - exclusions + inclusions`: newly declared default capabilities reach existing teams unless explicitly excluded. Custom profiles retain an exact set. A profile overrides that role's legacy grant list in its selected scope; direct user grants still compose with all assigned roles. Missing dependencies remove a capability from effective authority. `preview(roleId)` returns editor selections and stale names, not authorization credentials.

The same role can have different profiles in different teams. Team grants never become platform grants. `owner`/superadmin are reserved platform identities outside the configurable capability catalog: a tenant administrator cannot grant them by selecting all product capabilities. An optional `platformOwner` callback on `CapabilityAuthorizer` must verify trusted platform identity; never derive it from a tenant-editable role, request body or browser snapshot.

## Guard The Backend

```typescript
import { CapabilityAuthorizer } from '@beeblock/svelar/permissions';

export const access = new CapabilityAuthorizer(permissionManifest);
// Resolver reads authenticated server locals and authorized team context, never submitted IDs.
export const POST = access.guardEndpoint(
  'action.boards.create', controller.handle('store'), resolveCapabilityInput,
);
export const actions = access.guardPageActions({
  publish: { capability: 'action.boards.publish', handler: publishPageAction },
}, resolveCapabilityInput);
export const load = access.guardLayout(loadBoardPage, resolveCapabilityInput);
```

The resolver returns `{ principal, scope, context? }`. A user principal identifies its model type and internal numeric model ID; a scope is `{ teamId }` or `{ platform: true }`. Invalid/missing identity fails closed. Guards establish isolated tenant/actor context for the handler. Endpoint denials return a safe 401/403 `{ data, meta }` envelope; page/layout denials preserve SvelteKit HTTP control flow. Use enhanced-form error handling for non-disruptive page-action feedback.

User-bound API credentials must pass their authenticated `credentialCapabilities`: the effective result is the intersection of the credential ceiling and the user's current roles/direct grants, including screen dependencies. An API key cannot inherit every owner permission merely because its owner has a broad role. Service accounts require matching authenticated tenant/actor context and explicit credential grants; wildcard service grants include known team capabilities only, never platform access. Resource policies still apply after functional RBAC.

## Frontend Presentation

```typescript
// Server load, after authenticating and authorizing the scope:
const permissions = await access.snapshot(authenticatedInput);
// Browser component:
import { capabilityClient } from '@beeblock/svelar/permissions/client';
const can = capabilityClient(permissions).can;
```

Use the client-safe subpath for menus/buttons. Never import server permission services into the browser or trust a client snapshot to authorize a mutation. Always enforce the same capability on the HTTP action. Refetch server snapshots when assignments change.

The protected operational console at `/admin/dashboard` provides the technical capability catalog, scoped system/custom profile editor, empty-role creation and per-user role/direct-grant controls. New apps use this single backend; `/admin` is an authenticated capability-checked redirect, not a second role-management API. Each command has its own manifest capability and is guarded before FormRequest parsing. The six access operations are `users.access.view`, `permissions.create`, `users.roles.assign`, `users.roles.detach`, `users.capabilities.grant` and `users.capabilities.revoke` under the dashboard resource's action namespace.

Operational panels preserve the same authorization boundary while merging configured/local/shared-observed queue topology by connection and queue. Registry metadata, safe retained stacks, attempts/timestamps, timeline replay IDs and lock provenance remain visible with bounded coverage/truncation metadata. Incomplete aggregate worker/lock observations and optional dependencies without a public reachability proof stay unknown, never a manufactured healthy zero. Scheduler task/process pages use explicit URL offsets and totals; reaching the process source's observation cap reports an unknown total. These are presentation observations, not permission grants or proof of end-to-end service delivery.

Console role/grant forms use real Superforms-bound values and inline errors with `zod4Client` from the browser-safe `@beeblock/svelar/dashboard/schemas`; the backend FormRequests import the same framework Zod 4 schemas. This does not change Zod/Valibot selection for app-owned forms. Commands require explicit platform/team scope and confirmation. Creating a role creates an empty exact profile in that scope and assigns no users. An individual grant must name a current canonical capability in the selected scope; aliases, wildcards and inferred dependency grants are not accepted. Existing stale direct grants remain visible and may be revoked when present in the scoped snapshot.

Applications configure optional `DashboardPermissionProvider.createRole/getRole` and `DashboardUserProvider.access/assignRole/detachRole/grantCapability/revokeCapability` callbacks. Missing callbacks disable the corresponding controls and fail closed. Access snapshots are exact to the requested user/scope, with at most 100 roles and 10,000 bounded direct names. The core rejects self/protected-user changes, reserved owner roles and incompatible guards; providers must recheck persisted platform identity, self protection, authorized tenant membership and role-profile eligibility transactionally. Never update a trusted owner identity column from a configurable role assignment or fall back to legacy broad grants.

Use `Permissions.forTeam(teamId)` or `Permissions.global()` explicitly. Their `getModelRoles` and `getModelDirectPermissions` expose current scoped assignments; `assignRole/removeRole` and `giveModelPermission/revokeModelPermission` change that scope only. Catalog lookup by ID is `Permissions.findRoleById`; direct grants resolve seeded capability names with `Permissions.findPermission(name, guard)`. `PermissionProfiles.preview` describes a role profile, not a user's direct grants. UI snapshots and selections are presentation data, never authority. Console writes record auditable intent and outcomes, including the target identity and assignment scope.

## Aliases And Removal

Declare visible legacy aliases with `{ name, capabilities, label? }`; aliases may map to several canonical capabilities in one scope. Use scoped `PermissionProfiles.migrateLegacyAliases()` in a reviewed migration/command to replace old grants transactionally. Aliases must remain visible in the editor while relevant, not hidden bypasses.

Use `profiles.forTeam(teamId).deleteRole(roleId)` for removing a role from that team, including assignments/profile/grants in one transaction. The shared catalog remains for other teams. Global `Permissions.deleteRole(roleName, guard?)` removes the catalog role and all global/team assignments transactionally; reserve it for authorized platform administration. `remove(roleId)` removes a profile override and restores legacy role grants, so it is not equivalent to deleting a role.
