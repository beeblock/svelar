<script lang="ts">
  import { page } from '$app/state';
  import { Badge } from 'svelar/ui';
  import BookOpen from 'lucide-svelte/icons/book-open';
  import ChevronLeft from 'lucide-svelte/icons/chevron-left';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import { Icon } from 'svelar/ui';

  let { data } = $props();
</script>

<svelte:head>
  <title>{data.title} - Svelar Docs</title>
</svelte:head>

<div class="max-w-[1400px] mx-auto flex gap-0 lg:gap-8">
  <!-- Sidebar navigation -->
  <aside class="hidden lg:block w-64 shrink-0">
    <div class="sticky top-20">
      <div class="flex items-center gap-2 mb-6 px-3">
        <Icon icon={BookOpen} size={20} class="text-brand" />
        <span class="font-semibold text-gray-900">Documentation</span>
      </div>
      <nav class="space-y-0.5">
        {#each data.docs as doc}
          {@const isActive = doc.slug === data.slug}
          <a
            href="/docs/{doc.slug}"
            class="block px-3 py-2 text-sm rounded-md transition-colors {isActive
              ? 'bg-brand text-white font-medium'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}"
          >
            {doc.title}
          </a>
        {/each}
      </nav>
    </div>
  </aside>

  <!-- Mobile doc nav -->
  <div class="lg:hidden mb-6">
    <details class="group">
      <summary class="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
        <Icon icon={BookOpen} size={16} />
        <span>Documentation Menu</span>
        <Badge variant="secondary">{data.title}</Badge>
      </summary>
      <nav class="mt-2 pl-2 border-l-2 border-gray-200 space-y-1">
        {#each data.docs as doc}
          {@const isActive = doc.slug === data.slug}
          <a
            href="/docs/{doc.slug}"
            class="block px-3 py-1.5 text-sm rounded-md transition-colors {isActive
              ? 'text-brand font-medium'
              : 'text-gray-600 hover:text-gray-900'}"
          >
            {doc.title}
          </a>
        {/each}
      </nav>
    </details>
  </div>

  <!-- Main content -->
  <div class="flex-1 min-w-0">
    <article class="docs-content">
      {@html data.content}
    </article>

    <!-- Prev/Next navigation -->
    <div class="mt-12 pt-6 border-t border-gray-200 flex justify-between items-center">
      {#if data.prev}
        <a
          href="/docs/{data.prev.slug}"
          class="flex items-center gap-2 text-sm text-gray-600 hover:text-brand transition-colors"
        >
          <Icon icon={ChevronLeft} size={16} />
          <div>
            <div class="text-xs text-gray-400">Previous</div>
            <div class="font-medium">{data.prev.title}</div>
          </div>
        </a>
      {:else}
        <div></div>
      {/if}

      {#if data.next}
        <a
          href="/docs/{data.next.slug}"
          class="flex items-center gap-2 text-sm text-gray-600 hover:text-brand transition-colors text-right"
        >
          <div>
            <div class="text-xs text-gray-400">Next</div>
            <div class="font-medium">{data.next.title}</div>
          </div>
          <Icon icon={ChevronRight} size={16} />
        </a>
      {/if}
    </div>
  </div>
</div>

<style>
  :global(.docs-content) {
    line-height: 1.75;
    color: #1f2937;
  }

  :global(.docs-content h1) {
    font-size: 2rem;
    font-weight: 700;
    margin-bottom: 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid #e5e7eb;
    color: #111827;
  }

  :global(.docs-content h2) {
    font-size: 1.5rem;
    font-weight: 600;
    margin-top: 2.5rem;
    margin-bottom: 0.75rem;
    color: #111827;
  }

  :global(.docs-content h3) {
    font-size: 1.25rem;
    font-weight: 600;
    margin-top: 2rem;
    margin-bottom: 0.5rem;
    color: #1f2937;
  }

  :global(.docs-content h4) {
    font-size: 1.1rem;
    font-weight: 600;
    margin-top: 1.5rem;
    margin-bottom: 0.5rem;
    color: #374151;
  }

  :global(.docs-content p) {
    margin-bottom: 1rem;
  }

  :global(.docs-content a) {
    color: var(--color-brand, #4f46e5);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  :global(.docs-content a:hover) {
    opacity: 0.8;
  }

  :global(.docs-content code) {
    background: #f3f4f6;
    border-radius: 4px;
    padding: 0.15em 0.4em;
    font-size: 0.875em;
    font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
    color: #be185d;
  }

  :global(.docs-content pre) {
    background: #1e293b;
    color: #e2e8f0;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    overflow-x: auto;
    margin-bottom: 1.5rem;
    font-size: 0.875rem;
    line-height: 1.7;
  }

  :global(.docs-content pre code) {
    background: none;
    color: inherit;
    padding: 0;
    border-radius: 0;
    font-size: inherit;
  }

  :global(.docs-content ul) {
    list-style: disc;
    padding-left: 1.5rem;
    margin-bottom: 1rem;
  }

  :global(.docs-content ol) {
    list-style: decimal;
    padding-left: 1.5rem;
    margin-bottom: 1rem;
  }

  :global(.docs-content li) {
    margin-bottom: 0.375rem;
  }

  :global(.docs-content li > ul),
  :global(.docs-content li > ol) {
    margin-top: 0.375rem;
    margin-bottom: 0;
  }

  :global(.docs-content table) {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1.5rem;
    font-size: 0.875rem;
  }

  :global(.docs-content thead) {
    background: #f9fafb;
  }

  :global(.docs-content th) {
    text-align: left;
    padding: 0.625rem 0.75rem;
    border: 1px solid #e5e7eb;
    font-weight: 600;
    color: #374151;
  }

  :global(.docs-content td) {
    padding: 0.625rem 0.75rem;
    border: 1px solid #e5e7eb;
    color: #4b5563;
  }

  :global(.docs-content blockquote) {
    border-left: 4px solid var(--color-brand, #4f46e5);
    background: #f0f4ff;
    padding: 0.75rem 1rem;
    margin: 1rem 0 1.5rem;
    border-radius: 0 8px 8px 0;
    color: #374151;
  }

  :global(.docs-content blockquote p) {
    margin-bottom: 0;
  }

  :global(.docs-content hr) {
    border: none;
    border-top: 1px solid #e5e7eb;
    margin: 2rem 0;
  }

  :global(.docs-content strong) {
    font-weight: 600;
    color: #111827;
  }

  :global(.docs-content img) {
    max-width: 100%;
    border-radius: 8px;
  }
</style>
