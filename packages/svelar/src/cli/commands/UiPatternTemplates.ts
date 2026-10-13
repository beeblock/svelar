export const uiPatternNames = ['select', 'dialog', 'tabs', 'server-table', 'operation-tray', 'capability-editor'] as const;
export type UiPatternName = typeof uiPatternNames[number];

const requirements: Record<UiPatternName, readonly string[]> = {
  select: ['button', 'command', 'popover'],
  dialog: ['dialog'], tabs: ['tabs'],
  'server-table': ['button', 'input', 'label', 'select', 'table', 'tooltip'],
  'operation-tray': ['button', 'badge', 'progress'],
  'capability-editor': ['button', 'checkbox', 'input', 'label', 'tooltip', 'badge'],
};

/** App-owned patterns use installed shadcn primitives; no routes, persistence or demo records. */
export class UiPatternTemplates {
  static shadcnComponents(patterns: readonly UiPatternName[]): string[] {
    return [...new Set(patterns.flatMap((name) => requirements[name]))].sort();
  }

  static files(patterns: readonly UiPatternName[] = uiPatternNames, ddd = true): Array<{ path: string; content: string }> {
    const directory = ddd ? 'src/lib/shared/components/patterns' : 'src/lib/components/patterns';
    const alias = ddd ? '$lib/shared/components/patterns' : '$lib/components/patterns';
    const components: Record<UiPatternName, [string, () => string]> = {
      select: ['SearchableSelect', () => this.searchableSelect(alias)],
      dialog: ['ResponsiveDialog', () => this.responsiveDialog(alias)],
      tabs: ['UrlTabs', () => this.urlTabs(alias)],
      'server-table': ['ServerTable', () => this.serverTable(alias)],
      'operation-tray': ['OperationTray', () => this.operationTray(alias)],
      'capability-editor': ['CapabilityEditor', () => this.capabilityEditor(alias)],
    };
    return [
      { path: directory + '/contracts.ts', content: this.contracts() },
      { path: directory + '/helpers.ts', content: this.helpers(alias) },
      ...patterns.map((name) => ({ path: directory + '/' + components[name][0] + '.svelte', content: components[name][1]() })),
    ];
  }

  static contracts(): string {
    return `import type { ManifestCapability, LegacyPermissionAlias, CapabilityScope } from '@beeblock/svelar/permissions';
import type { OperationRecord } from '@beeblock/svelar/operations';
export type { ManifestCapability, CapabilityScope };
export type ManifestAlias = LegacyPermissionAlias & { label: string; scope: CapabilityScope; deprecated: true };
export interface SelectOption { value: string; label: string; disabled?: boolean; keywords?: string[] }
export interface UrlTab { value: string; label: string; disabled?: boolean }
export interface TableQuery { page: number; perPage: number; search: string; sort: string; direction: 'asc' | 'desc' }
export interface TableColumn<Row> { key: string; label: string; text: (row: Row) => string; sortable?: boolean; truncate?: boolean }
export type OperationSummary = Pick<OperationRecord, 'id' | 'label' | 'state' | 'progress' | 'total' | 'returnUrl' | 'error' | 'cancelRequested'>;
`;
  }

  static helpers(alias: string): string {
    return `import type { ManifestCapability, CapabilityScope, TableQuery, UrlTab } from '${alias}/contracts.js';

export function tabValue(url: URL, tabs: readonly UrlTab[], key = 'tab'): string {
  const enabled = tabs.filter((tab) => !tab.disabled);
  if (!enabled.length || new Set(tabs.map((tab) => tab.value)).size !== tabs.length) throw new Error('Tabs require unique values and an enabled item.');
  return enabled.find((tab) => tab.value === url.searchParams.get(key))?.value ?? enabled[0].value;
}
export function tabUrl(url: URL, value: string, key = 'tab'): URL {
  const next = new URL(url); next.searchParams.set(key, value); return next;
}
function boundedInteger(value: string | null, fallback: number, maximum: number): number {
  const number = Number(value);
  return value !== null && /^[0-9]+$/.test(value) && Number.isSafeInteger(number) && number > 0 && number <= maximum ? number : fallback;
}
export function tableQuery(url: URL, sortKeys: readonly string[], defaultSize = 25): TableQuery {
  return { page: boundedInteger(url.searchParams.get('page'), 1, 100000), perPage: boundedInteger(url.searchParams.get('perPage'), defaultSize, 100),
    search: (url.searchParams.get('search') ?? '').slice(0, 500), sort: sortKeys.includes(url.searchParams.get('sort') ?? '') ? url.searchParams.get('sort')! : '',
    direction: url.searchParams.get('direction') === 'desc' ? 'desc' : 'asc' };
}
export function tableUrl(url: URL, query: TableQuery): URL {
  const next = new URL(url);
  for (const [key, value] of Object.entries(query)) if (value === '') next.searchParams.delete(key); else next.searchParams.set(key, String(value));
  return next;
}
export function operationHref(value: string | null): string | null {
  if (!value || value.length > 2048 || !value.startsWith('/') || /[\\\\\\x00-\\x20\\x7f]/.test(value)) return null;
  try { const decoded = decodeURIComponent(value); return decoded.startsWith('//') || /[\\\\\\x00-\\x1f\\x7f]/.test(decoded) ? null : value; } catch { return null; }
}
export function operationProgress(progress: number, total: number | null): number | null {
  return total === null || !Number.isFinite(total) || total <= 0 || !Number.isFinite(progress) ? null : Math.max(0, Math.min(100, progress / total * 100));
}
export function focusableScrollRegion(node: HTMLElement): { destroy(): void } {
  const update = () => {
    const target = node.querySelector<HTMLElement>('[data-slot="table-container"]') ?? node;
    target.tabIndex = target.scrollWidth > target.clientWidth + 1 || target.scrollHeight > target.clientHeight + 1 ? 0 : -1;
    if (target !== node) {
      target.setAttribute('role', 'region');
      const label = node.getAttribute('aria-label') ?? 'Table';
      if (target.getAttribute('aria-label') !== label) target.setAttribute('aria-label', label);
      target.classList.add('focus-visible:outline-2', 'focus-visible:outline-ring');
    }
  };
  const resize = new ResizeObserver(update);
  const observe = () => { resize.observe(node); for (const child of Array.from(node.children)) resize.observe(child); update(); };
  const changes = new MutationObserver(observe);
  changes.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] });
  observe();
  return { destroy() { resize.disconnect(); changes.disconnect(); } };
}
export function scopedCatalog(catalog: readonly ManifestCapability[], scope: CapabilityScope): ManifestCapability[] {
  if (!['team', 'platform'].includes(scope) || catalog.length > 10000) throw new Error('Invalid capability catalog scope.');
  const result = catalog.filter((item) => item.scope === scope);
  if (new Set(result.map((item) => item.name)).size !== result.length) throw new Error('Duplicate capability catalog entries.');
  return result;
}
// Presentation only: the server must validate every grant and authorize the target role/team.
export function toggleCapabilities(catalog: readonly ManifestCapability[], current: readonly string[], names: readonly string[], checked: boolean): string[] {
  if (current.length > 10000 || names.length > 10000) throw new Error('Capability selection exceeds its bound.');
  const entries = new Map(catalog.map((item) => [item.name as string, item]));
  const result = new Set(current);
  const pending = [...names];
  const visited = new Set<string>();
  const dependents = new Map<string, string[]>();
  let edges = 0;
  for (const item of catalog) for (const dependency of item.dependencies) {
    if (++edges > 100000 || !entries.has(dependency)) throw new Error('Capability dependencies are unavailable in this scope.');
    const names = dependents.get(dependency) ?? []; names.push(item.name); dependents.set(dependency, names);
  }
  while (pending.length) {
    const name = pending.pop()!;
    if (visited.has(name)) continue;
    visited.add(name);
    const item = entries.get(name);
    if (!item) throw new Error('Capability is unavailable in this scope.');
    if (checked) { result.add(name); pending.push(...item.dependencies); }
    else { result.delete(name); pending.push(...(dependents.get(name) ?? []).filter((dependent) => result.has(dependent))); }
  }
  return [...result].sort();
}
export function profileSelection(defaults: readonly string[], exclusions: readonly string[], inclusions: readonly string[]): string[] {
  return [...new Set([...defaults.filter((name) => !exclusions.includes(name)), ...inclusions])].sort();
}
export function profileOverrides(catalog: readonly ManifestCapability[], selected: readonly string[], defaults: readonly string[], previous: { inclusions: readonly string[]; exclusions: readonly string[] }): { inclusions: string[]; exclusions: string[] } {
  const known = new Set(catalog.map((item) => item.name as string));
  const desired = new Set(selected);
  const basis = new Set(defaults);
  return { inclusions: [...new Set([...previous.inclusions.filter((name) => !known.has(name)), ...selected.filter((name) => known.has(name) && !basis.has(name))])].sort(),
    exclusions: [...new Set([...previous.exclusions.filter((name) => !known.has(name)), ...defaults.filter((name) => known.has(name) && !desired.has(name))])].sort() };
}
`;
  }

  static searchableSelect(alias: string): string {
    return `<script lang="ts">
  import * as Popover from '$lib/components/ui/popover/index.js';
  import * as Command from '$lib/components/ui/command/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import Check from '@lucide/svelte/icons/check';
  import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
  import X from '@lucide/svelte/icons/x';
  import type { SelectOption } from '${alias}/contracts.js';
  interface Props { options: readonly SelectOption[]; value?: string | string[]; multiple?: boolean; label: string; name?: string; id?: string;
    placeholder?: string; searchLabel?: string; disabled?: boolean; loading?: boolean; error?: string; onchange?: (value: string | string[]) => void; onretry?: () => void }
  let { options, multiple = false, value = $bindable(multiple ? [] : ''), label, name, id, placeholder = 'Select...', searchLabel = 'Search options',
    disabled = false, loading = false, error = '', onchange, onretry }: Props = $props();
  let open = $state(false);
  const selected = $derived(Array.isArray(value) ? value : value ? [value] : []);
  const summary = $derived(multiple ? selected.length ? selected.length + ' selected' : placeholder : options.find((option) => option.value === value)?.label ?? placeholder);
  function choose(option: SelectOption) {
    if (disabled || loading || option.disabled) return;
    value = multiple ? selected.includes(option.value) ? selected.filter((item) => item !== option.value) : [...selected, option.value] : option.value;
    onchange?.(value); if (!multiple) open = false;
  }
</script>
<div class="min-w-0 space-y-2">
  <Popover.Root bind:open>
    <Popover.Trigger {id}>
      {#snippet child({ props })}<Button {...props} type="button" variant="outline" role="combobox" aria-label={label} aria-expanded={open} aria-invalid={Boolean(error)} disabled={disabled || loading} class="w-full min-w-0 justify-between rounded-md"><span class="truncate">{loading ? 'Loading...' : summary}</span><ChevronsUpDown class="size-4 shrink-0 opacity-50" /></Button>{/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-[var(--bits-popover-anchor-width)] max-w-[calc(100vw-2rem)] p-0">
      <Command.Root>
        <Command.Input placeholder={searchLabel} aria-label={searchLabel} />
        <Command.List aria-multiselectable={multiple} class="max-h-[min(20rem,70dvh)] overflow-y-auto overscroll-contain">
          <Command.Empty>No matching options.</Command.Empty>
          <Command.Group>{#each options as option (option.value)}<Command.Item value={option.value} keywords={[option.label, ...(option.keywords ?? [])]} aria-selected={selected.includes(option.value)} disabled={option.disabled} onSelect={() => choose(option)}><Check class={'size-4 shrink-0 ' + (selected.includes(option.value) ? 'opacity-100' : 'opacity-0')} /><span class="min-w-0 break-words">{option.label}</span></Command.Item>{/each}</Command.Group>
        </Command.List>
      </Command.Root>
    </Popover.Content>
  </Popover.Root>
  {#if selected.length}<Button type="button" variant="ghost" size="icon" title={'Clear ' + label} aria-label={'Clear ' + label} disabled={disabled || loading} onclick={() => { value = multiple ? [] : ''; onchange?.(value); }}><X class="size-4" /></Button>{/if}
  {#if name}{#each selected as item}<input type="hidden" {name} value={item} />{/each}{/if}
  {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{#if onretry}<Button type="button" variant="outline" disabled={loading} onclick={onretry}>Retry</Button>{/if}{/if}
</div>
`;
  }

  static responsiveDialog(alias = '$lib/shared/components/patterns'): string {
    return `<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import type { Snippet } from 'svelte';
  import { focusableScrollRegion } from '${alias}/helpers.js';
  interface Props { open?: boolean; title: string; description: string; children: Snippet; footer?: Snippet; pending?: boolean }
  let { open = $bindable(false), title, description, children, footer, pending = false }: Props = $props();
  let origin: HTMLElement | null = null;
</script>
<Dialog.Root bind:open>
  <Dialog.Content showCloseButton={!pending} escapeKeydownBehavior={pending ? 'ignore' : 'close'} onInteractOutside={(event) => { if (pending) event.preventDefault(); }} onOpenAutoFocus={() => { origin = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onCloseAutoFocus={(event) => { if (origin?.isConnected) { event.preventDefault(); origin.focus(); } }} class="flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100vw-2rem)] flex-col gap-0 rounded-lg p-0 sm:max-w-2xl">
    <Dialog.Header class="shrink-0 border-b px-5 py-4 pr-12"><Dialog.Title class="break-words text-lg">{title}</Dialog.Title><Dialog.Description class="break-words">{description}</Dialog.Description></Dialog.Header>
    <div role="region" aria-label={title} use:focusableScrollRegion class="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{@render children()}</div>
    {#if footer}<Dialog.Footer class="shrink-0 flex-wrap border-t px-5 py-4">{@render footer()}</Dialog.Footer>{/if}
  </Dialog.Content>
</Dialog.Root>
`;
  }

  static urlTabs(alias: string): string {
    return `<script lang="ts">
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { Snippet } from 'svelte';
  import type { UrlTab } from '${alias}/contracts.js';
  import { tabValue, tabUrl } from '${alias}/helpers.js';
  interface Props { tabs: readonly UrlTab[]; label: string; queryKey?: string; children: Snippet<[string]> }
  let { tabs, label, queryKey = 'tab', children }: Props = $props();
  const selected = $derived(tabValue(page.url, tabs, queryKey));
  // svelte-ignore state_referenced_locally
  let active = $state(selected);
  let pending = $state(false); let notice = $state('');
  $effect(() => { active = selected; });
  async function select(value: string) {
    if (pending || value === selected || !tabs.some((tab) => tab.value === value && !tab.disabled)) return;
    pending = true; notice = '';
    try { await goto(tabUrl(page.url, value, queryKey), { noScroll: true, keepFocus: true }); }
    catch { active = selected; notice = 'Unable to open this section. Please retry.'; }
    finally { pending = false; }
  }
</script>
<Tabs.Root bind:value={active} onValueChange={select} aria-busy={pending} class="flex min-w-0 flex-col">
  <Tabs.List aria-label={label} class="h-auto max-w-full justify-start overflow-x-auto rounded-md">{#each tabs as tab (tab.value)}<Tabs.Trigger value={tab.value} disabled={tab.disabled || pending} class="shrink-0 flex-none px-3 py-2">{tab.label}</Tabs.Trigger>{/each}</Tabs.List>
  {#each tabs as tab (tab.value)}<Tabs.Content value={tab.value} class="min-w-0">{@render children(tab.value)}</Tabs.Content>{/each}
</Tabs.Root>
{#if notice}<p role="alert" class="text-sm text-destructive">{notice}</p>{/if}
`;
  }

  static serverTable(alias: string): string {
    return `<script lang="ts" generics="Row">
  import * as Table from '$lib/components/ui/table/index.js';
  import * as Tooltip from '$lib/components/ui/tooltip/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronsLeft from '@lucide/svelte/icons/chevrons-left';
  import ChevronsRight from '@lucide/svelte/icons/chevrons-right';
  import ArrowUpDown from '@lucide/svelte/icons/arrow-up-down';
  import Info from '@lucide/svelte/icons/info';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Search from '@lucide/svelte/icons/search';
  import type { Snippet } from 'svelte';
  import type { TableColumn, TableQuery } from '${alias}/contracts.js';
  import { focusableScrollRegion } from '${alias}/helpers.js';
  interface Props { rows: readonly Row[]; columns: readonly TableColumn<Row>[]; getRowId: (row: Row) => string | number; query: TableQuery; total: number;
    label: string; loading?: boolean; error?: string; pageSizes?: readonly number[]; filters?: Snippet; onquery: (query: TableQuery) => void | Promise<void>; onretry?: () => void | Promise<void> }
  let { rows, columns, getRowId, query, total, label, loading = false, error = '', pageSizes = [10, 25, 50, 100], filters, onquery, onretry }: Props = $props();
  let pending = $state(false); let notice = $state('');
  // svelte-ignore state_referenced_locally
  let search = $state(query.search);
  const searchId = $props.id();
  const busy = $derived(loading || pending);
  const pages = $derived(Math.max(1, Math.ceil(total / query.perPage)));
  $effect(() => { search = query.search; });
  async function change(patch: Partial<TableQuery>) {
    if (busy) return; pending = true; notice = '';
    try { await onquery({ ...query, ...patch }); } catch { notice = 'Unable to load records. Please retry.'; } finally { pending = false; }
  }
  async function retry() {
    if (busy || !onretry) return; pending = true; notice = '';
    try { await onretry(); } catch { notice = 'Unable to load records. Please retry.'; } finally { pending = false; }
  }
</script>
<Tooltip.Provider>
  <section aria-label={label} aria-busy={busy} class="min-w-0 space-y-3">
    <form class="flex flex-wrap items-end gap-3" onsubmit={(event) => { event.preventDefault(); void change({ search, page: 1 }); }}>
      <div class="min-w-0 flex-1 space-y-1"><Label for={searchId}>Search</Label><Input id={searchId} bind:value={search} disabled={busy} class="min-w-0" /></div>
      <Button type="submit" variant="outline" size="icon" title="Search records" aria-label="Search records" disabled={busy}><Search class="size-4" /></Button>
      {#if filters}{@render filters()}{/if}
    </form>
    {#if error || notice}<p role="alert" class="text-sm text-destructive">{error || notice}</p>{#if onretry}<Button type="button" variant="outline" disabled={busy} onclick={retry}><RefreshCw class="size-4" />Retry</Button>{/if}{/if}
    <div role="group" aria-label={label + ' table'} use:focusableScrollRegion class="max-w-full overflow-x-auto rounded-md border focus-visible:outline-2 focus-visible:outline-ring">
      <Table.Root class="w-full min-w-[40rem] table-fixed">
        <Table.Header><Table.Row>{#each columns as column (column.key)}<Table.Head class="whitespace-normal break-words" aria-sort={query.sort === column.key ? query.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
          {#if column.sortable}<Button type="button" variant="ghost" class="max-w-full px-0" disabled={busy} onclick={() => change({ page: 1, sort: column.key, direction: query.sort === column.key && query.direction === 'asc' ? 'desc' : 'asc' })}><span class="truncate">{column.label}</span><ArrowUpDown class="size-4 shrink-0" /></Button>{:else}{column.label}{/if}
        </Table.Head>{/each}</Table.Row></Table.Header>
        <Table.Body>{#each rows as row (getRowId(row))}<Table.Row>{#each columns as column (column.key)}<Table.Cell>
          {#if column.truncate}<div class="flex min-w-0 items-center gap-1"><span class="min-w-0 flex-1 truncate">{column.text(row)}</span><Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} type="button" variant="ghost" size="icon" class="size-6 shrink-0" aria-label={'Full ' + column.label}><Info class="size-3" /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content class="max-w-[min(24rem,calc(100vw-2rem))] break-words">{column.text(row)}</Tooltip.Content></Tooltip.Root></div>{:else}<span class="break-words">{column.text(row)}</span>{/if}
        </Table.Cell>{/each}</Table.Row>{:else}<Table.Row><Table.Cell colspan={Math.max(1, columns.length)} class="h-24 text-center">{busy ? 'Loading...' : error || notice ? 'Records unavailable.' : 'No records.'}</Table.Cell></Table.Row>{/each}</Table.Body>
      </Table.Root>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-3 text-sm"><span aria-live="polite">{total} records</span><div class="flex flex-wrap items-center gap-2">
      <Select.Root type="single" value={String(query.perPage)} disabled={busy} onValueChange={(value) => { const perPage = Number(value); if (pageSizes.includes(perPage)) void change({ perPage, page: 1 }); }}><Select.Trigger aria-label="Rows per page" class="w-24">{query.perPage}</Select.Trigger><Select.Content>{#each pageSizes as size}<Select.Item value={String(size)} label={String(size)}>{size}</Select.Item>{/each}</Select.Content></Select.Root>
      <span>Page {query.page} of {pages}</span>
      {#each [{ icon: ChevronsLeft, page: 1, label: 'First page', disabled: query.page <= 1 }, { icon: ChevronLeft, page: query.page - 1, label: 'Previous page', disabled: query.page <= 1 }, { icon: ChevronRight, page: query.page + 1, label: 'Next page', disabled: query.page >= pages }, { icon: ChevronsRight, page: pages, label: 'Last page', disabled: query.page >= pages }] as control}<Button type="button" variant="outline" size="icon" title={control.label} aria-label={control.label} disabled={busy || control.disabled} onclick={() => change({ page: control.page })}><control.icon class="size-4" /></Button>{/each}
    </div></div>
  </section>
</Tooltip.Provider>
`;
  }

  static operationTray(alias: string): string {
    return `<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Progress } from '$lib/components/ui/progress/index.js';
  import X from '@lucide/svelte/icons/x';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { SvelteMap } from 'svelte/reactivity';
  import type { OperationSummary } from '${alias}/contracts.js';
  import { operationHref, operationProgress } from '${alias}/helpers.js';
  interface Props { operations: readonly OperationSummary[]; loading?: boolean; error?: string; onrefresh?: () => void | Promise<void>;
    oncancel?: (id: string) => void | Promise<void>; onretry?: (id: string) => void | Promise<void> }
  let { operations, loading = false, error = '', onrefresh, oncancel, onretry }: Props = $props();
  let pending = $state<string[]>([]); const notices = new SvelteMap<string, string>();
  let refreshing = $state(false); let refreshError = $state('');
  const busy = $derived(loading || refreshing);
  async function refresh() {
    if (busy || !onrefresh) return; refreshing = true; refreshError = '';
    try { await onrefresh(); } catch { refreshError = 'Unable to load operations. Please retry.'; } finally { refreshing = false; }
  }
  async function request(id: string, action: ((id: string) => void | Promise<void>) | undefined) {
    if (!action || pending.includes(id)) return;
    pending = [...pending, id]; notices.set(id, '');
    try { await action(id); } catch { notices.set(id, 'Unable to complete this request. Please retry.'); }
    finally { pending = pending.filter((item) => item !== id); }
  }
</script>
<section aria-label="Operations" aria-busy={busy} class="min-w-0">
  <header class="flex items-center justify-between gap-3 border-b pb-2"><h2 class="text-base font-semibold">Operations</h2>{#if onrefresh}<Button type="button" variant="ghost" size="icon" title="Refresh operations" aria-label="Refresh operations" disabled={busy} onclick={refresh}><RefreshCw class="size-4" /></Button>{/if}</header>
  {#if error || refreshError}<p role="alert" class="py-3 text-sm text-destructive">{error || refreshError}</p>{/if}
  <ul class="divide-y">{#each operations as operation (operation.id)}{@const progress = operationProgress(operation.progress, operation.total)}{@const href = operationHref(operation.returnUrl)}
    <li class="min-w-0 space-y-2 py-3"><div class="flex flex-wrap items-start gap-2"><span class="min-w-0 flex-1 break-words text-sm font-medium">{operation.label}</span><Badge variant={operation.state === 'failed' ? 'destructive' : 'secondary'} class="rounded-md">{operation.state}</Badge></div>
      {#if operation.state === 'running'}{#if progress !== null}<Progress value={progress} aria-label={operation.label + ' progress'} /><span class="text-xs text-muted-foreground">{operation.progress} / {operation.total}</span>{:else}<span role="status" class="flex items-center gap-2 text-sm"><LoaderCircle class="size-4 motion-safe:animate-spin" />Running</span>{/if}{/if}
      {#if operation.error && operation.state === 'failed'}<p role="alert" class="break-words text-sm text-destructive">{operation.error}</p>{/if}
      {#if notices.get(operation.id)}<p role="alert" class="text-sm text-destructive">{notices.get(operation.id)}</p>{/if}
      <div class="flex flex-wrap items-center gap-2">{#if href}<a href={href} class="text-sm underline underline-offset-4">Open</a>{/if}
        {#if oncancel && ['queued', 'running'].includes(operation.state)}{#if operation.cancelRequested}<span role="status" class="text-xs text-muted-foreground">Cancellation requested</span>{:else}<Button type="button" variant="ghost" size="icon" title={'Cancel ' + operation.label} aria-label={'Cancel ' + operation.label} disabled={pending.includes(operation.id)} onclick={() => request(operation.id, oncancel)}><X class="size-4" /></Button>{/if}{/if}
        {#if onretry && operation.state === 'failed'}<Button type="button" variant="outline" disabled={pending.includes(operation.id)} onclick={() => request(operation.id, onretry)}><RotateCcw class="size-4" />Retry</Button>{/if}
      </div>
    </li>{:else}<li role="status" class="py-6 text-sm text-muted-foreground">{busy ? 'Loading operations...' : error || refreshError ? 'Operations unavailable.' : 'No operations.'}</li>{/each}</ul>
</section>
`;
  }

  static capabilityEditor(alias: string): string {
    return `<script lang="ts">
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import * as Tooltip from '$lib/components/ui/tooltip/index.js';
  import CheckCheck from '@lucide/svelte/icons/check-check';
  import SquareMinus from '@lucide/svelte/icons/square-minus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import type { ManifestCapability, ManifestAlias, CapabilityScope } from '${alias}/contracts.js';
  import { scopedCatalog, toggleCapabilities, profileSelection, profileOverrides } from '${alias}/helpers.js';
  interface Props { catalog: readonly ManifestCapability[]; aliases?: readonly ManifestAlias[]; scope?: CapabilityScope; value?: string[];
    mode?: 'custom' | 'system'; defaults?: readonly string[]; inclusions?: string[]; exclusions?: string[];
    disabled?: boolean; error?: string; onchange?: (value: string[]) => void }
  let { catalog, aliases = [], scope = 'team', value = $bindable([]), mode = 'custom', defaults = [], inclusions = $bindable([]), exclusions = $bindable([]), disabled = false, error = '', onchange }: Props = $props();
  let search = $state(''); let notice = $state('');
  const baseId = $props.id();
  const entries = $derived(scopedCatalog(catalog, scope));
  const current = $derived(mode === 'system' ? profileSelection(defaults, exclusions, inclusions) : value);
  const selected = $derived(new Set(current));
  const groups = $derived([...new Set(entries.map((item) => item.group))].sort());
  const stale = $derived([...new Set([...current, ...inclusions, ...exclusions].filter((name) => !entries.some((item) => item.name === name)))].sort());
  const legacy = $derived(aliases.filter((alias) => alias.scope === scope && alias.capabilities.every((name) => entries.some((item) => item.name === name))));
  function matches(item: ManifestCapability) { return (item.label + ' ' + item.name + ' ' + item.group).toLowerCase().includes(search.trim().toLowerCase()); }
  function screenItems(screen: string) { return entries.filter((item) => item.screen === screen); }
  function choose(names: readonly string[], checked: boolean) {
    if (disabled) return;
    try {
      const next = toggleCapabilities(entries, current, names, checked);
      if (mode === 'system') { const overrides = profileOverrides(entries, next, defaults, { inclusions, exclusions }); inclusions = overrides.inclusions; exclusions = overrides.exclusions; }
      else value = next;
      notice = ''; onchange?.(next);
    } catch { notice = 'Unable to update this capability selection.'; }
  }
  function removeStale(name: string) {
    if (disabled) return;
    value = value.filter((item) => item !== name); inclusions = inclusions.filter((item) => item !== name); exclusions = exclusions.filter((item) => item !== name);
    onchange?.(mode === 'system' ? profileSelection(defaults, exclusions, inclusions) : value);
  }
</script>
<Tooltip.Provider>
  <section aria-label="Capabilities" class="min-w-0 space-y-4">
    <div class="flex flex-wrap items-end gap-3"><div class="min-w-0 flex-1 space-y-1"><Label for={baseId + '-search'}>Search capabilities</Label><Input id={baseId + '-search'} bind:value={search} disabled={disabled} /></div><span aria-live="polite" class="text-sm text-muted-foreground">{current.filter((name) => entries.some((item) => item.name === name)).length} selected</span></div>
    {#if error || notice}<p role="alert" class="text-sm text-destructive">{error || notice}</p>{/if}
    {#each groups as group}{@const screens = entries.filter((item) => item.kind === 'screen' && item.group === group && (matches(item) || screenItems(item.screen).some(matches)))}
      {#if screens.length}<section class="min-w-0 space-y-2" aria-label={group}><h3 class="break-words text-sm font-semibold">{group}</h3>{#each screens as screen (screen.name)}
        <fieldset class="min-w-0 border-b pb-3"><legend class="flex w-full flex-wrap items-center gap-2 py-2"><Checkbox id={baseId + '-' + screen.name} checked={selected.has(screen.name)} disabled={disabled} onCheckedChange={(checked) => choose([screen.name], checked)} /><Label for={baseId + '-' + screen.name} class="min-w-0 flex-1 break-words font-medium">{screen.label}</Label>
          {#each [{ icon: CheckCheck, checked: true, label: 'Select all ' + screen.label }, { icon: SquareMinus, checked: false, label: 'Clear ' + screen.label }] as action}<Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} type="button" variant="ghost" size="icon" aria-label={action.label} disabled={disabled} onclick={() => choose(screenItems(screen.screen).map((item) => item.name), action.checked)}><action.icon class="size-4" /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{action.label}</Tooltip.Content></Tooltip.Root>{/each}
        </legend><div class="grid min-w-0 gap-3 pl-6 sm:grid-cols-2 lg:grid-cols-3">{#each screenItems(screen.screen).filter((item) => item.kind === 'action' && (matches(screen) || matches(item))) as action (action.name)}<div class="flex min-w-0 items-start gap-2"><Checkbox id={baseId + '-' + action.name} checked={selected.has(action.name)} disabled={disabled} onCheckedChange={(checked) => choose([action.name], checked)} /><Label for={baseId + '-' + action.name} class="min-w-0 break-words">{action.label}</Label></div>{/each}</div></fieldset>
      {/each}</section>{/if}
    {/each}
    {#if !entries.some(matches)}<p role="status" class="text-sm text-muted-foreground">No matching capabilities.</p>{/if}
    {#if legacy.length}<fieldset class="min-w-0 space-y-2 border-t pt-3"><legend class="text-sm font-semibold">Legacy permissions</legend>{#each legacy as alias (alias.name)}<div class="flex min-w-0 items-center gap-2"><Checkbox id={baseId + '-alias-' + alias.name} checked={alias.capabilities.every((name) => selected.has(name))} indeterminate={alias.capabilities.some((name) => selected.has(name)) && !alias.capabilities.every((name) => selected.has(name))} disabled={disabled} onCheckedChange={(checked) => choose(alias.capabilities, checked)} /><Label for={baseId + '-alias-' + alias.name} class="min-w-0 flex-1 break-words">{alias.label}</Label><Badge variant="secondary" class="rounded-md">Legacy</Badge></div>{/each}</fieldset>{/if}
    {#if stale.length}<section aria-label="Unavailable capabilities" class="space-y-2 border-t pt-3"><h3 class="text-sm font-semibold">Unavailable capabilities</h3>{#each stale as name}<div class="flex min-w-0 items-center gap-2"><span class="min-w-0 flex-1 break-all text-sm">{name}</span><Button type="button" variant="ghost" size="icon" title={'Remove ' + name} aria-label={'Remove ' + name} disabled={disabled} onclick={() => removeStale(name)}><Trash2 class="size-4" /></Button></div>{/each}</section>{/if}
  </section>
</Tooltip.Provider>
`;
  }
}
