# Datatable Integration

Read the maintained [Datatable guide](../../../../docs/33-datatable.md) and the separate package's README/DOCUMENTATION.md. Outside this repo, use https://svelar.dev/docs/datatable. The plugin is its own Git repository; never absorb it into core Git.

## Current Contract

- Current plugin targets Svelar ^0.8.0, Svelte 5 and Node 22.12+. Import the UI from @beeblock/svelar-datatable/ui, stores/types from the client-safe entry, and controllers/services from /server.
- Construct DataTableController(model, options) and bind instance.handle('query'), not handle() without an action or a removed static handle API.
- Guard table reads and writes with the host capability resolver and preserve authentication, tenant membership, policies, origin/CSRF and server-owned searchable/orderable allowlists.
- DataTables draw/recordsTotal/recordsFiltered/data is an explicit wire-protocol response exception. POST validation is bounded; malformed requests are 400, driver failures generic 500.
- The store debounces search/sort/filters, aborts superseded requests, rejects stale draws and maintains visible current state. Browser mutations retain same-origin CSRF and report failures.

## Indexed Search

Auto Meilisearch applies only when it preserves all constraints. Tenant/soft-delete guards, global scopes, base queries, active scopes, column searches, computed SQL fields and unmapped custom filters require database fallback. Explicit meilisearch mode fails when the index cannot preserve them; it must never silently return another tenant's documents.

Configure actual Searchable displayed/searchable/filterable/sortable fields. Use validated serverParams plus host-owned custom filter/index mappings. Indexed results are index documents, not a claim that database-only predicates were applied.

## Excel Editing And Customization

Cell mutations follow route -> controller -> shared-schema FormRequest -> DTO -> action/service -> repository/model -> resource. Rejecting onCellEdit restores the previous value. Prove server editing, pagination, action buttons, validation failures and permission denial in a real browser.

CSV/clipboard/browser print/PDF are supported; Excel uses optional ExcelJS. Column ordering is programmatic, not an implemented draggable/resizable header feature.

The actual UI consumes 26 classNames hooks, documented in the guide. Eight extra type-declared hooks are unused; do not promise all keys style all surfaces. unstyled omits outer standard classes but retains child scoped styles. EditorFieldDef.className customizes editor inputs. Preserve loading/empty/error states and use custom snippets, named filters and service extension points rather than editing dependency internals.
