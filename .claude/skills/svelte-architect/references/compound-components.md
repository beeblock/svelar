# Compound Components Pattern

Full implementation patterns for flexible, declarative component APIs.

## Tabs Implementation

### tabs.svelte.ts
```typescript
import { getContext, setContext } from 'svelte';

const TABS_KEY = Symbol('tabs');

export interface TabsContext {
  activeTab: string;
  setActiveTab: (id: string) => void;
  registerTab: (id: string) => void;
  tabs: string[];
}

export function createTabsContext(defaultTab?: string) {
  let activeTab = $state(defaultTab ?? '');
  let tabs = $state<string[]>([]);

  function setActiveTab(id: string) {
    activeTab = id;
  }

  function registerTab(id: string) {
    if (!tabs.includes(id)) {
      tabs = [...tabs, id];
      if (!activeTab) activeTab = id;
    }
  }

  return {
    get activeTab() { return activeTab; },
    setActiveTab,
    registerTab,
    get tabs() { return tabs; }
  };
}

export function setTabsContext(ctx: TabsContext) {
  setContext(TABS_KEY, ctx);
}

export function getTabsContext(): TabsContext {
  return getContext<TabsContext>(TABS_KEY);
}
```

### Tabs.svelte
```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { createTabsContext, setTabsContext } from './tabs.svelte.ts';

  interface Props {
    defaultTab?: string;
    class?: string;
    children: Snippet;
  }

  let { defaultTab, class: className = '', children }: Props = $props();

  const ctx = createTabsContext(defaultTab);
  setTabsContext(ctx);
</script>

<div class="tabs {className}">
  {@render children()}
</div>
```

### Tab.svelte
```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getTabsContext } from './tabs.svelte.ts';
  import { onMount } from 'svelte';

  interface Props {
    id: string;
    disabled?: boolean;
    children: Snippet;
  }

  let { id, disabled = false, children }: Props = $props();

  const ctx = getTabsContext();
  const isActive = $derived(ctx.activeTab === id);

  onMount(() => ctx.registerTab(id));
</script>

<button
  role="tab"
  aria-selected={isActive}
  class:active={isActive}
  {disabled}
  onclick={() => !disabled && ctx.setActiveTab(id)}
>
  {@render children()}
</button>
```
