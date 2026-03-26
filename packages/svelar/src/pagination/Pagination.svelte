<!--
  Svelar Pagination Component

  @example
  ```svelte
  <script>
    import Pagination from 'svelar/pagination/Pagination.svelte';
    let { data } = $props();
  </script>

  <Pagination
    page={data.users.page}
    lastPage={data.users.lastPage}
    total={data.users.total}
    perPage={data.users.perPage}
    onPageChange={(p) => goto(`?page=${p}`)}
  />
  ```
-->

<script lang="ts">
  interface Props {
    page: number;
    lastPage: number;
    total: number;
    perPage: number;
    onPageChange?: (page: number) => void;
    /** Max visible page numbers (default: 7) */
    maxVisible?: number;
    /** Show first/last buttons */
    showEnds?: boolean;
    /** Show "Showing X to Y of Z results" text */
    showInfo?: boolean;
  }

  let {
    page = 1,
    lastPage = 1,
    total = 0,
    perPage = 15,
    onPageChange,
    maxVisible = 7,
    showEnds = true,
    showInfo = true,
  }: Props = $props();

  function getVisiblePages(): (number | '...')[] {
    if (lastPage <= maxVisible) {
      return Array.from({ length: lastPage }, (_, i) => i + 1);
    }

    const pages: (number | '...')[] = [];
    const half = Math.floor(maxVisible / 2);

    let start = Math.max(2, page - half);
    let end = Math.min(lastPage - 1, page + half);

    // Adjust if near the beginning
    if (page <= half + 1) {
      end = maxVisible - 1;
    }
    // Adjust if near the end
    if (page >= lastPage - half) {
      start = lastPage - maxVisible + 2;
    }

    pages.push(1);
    if (start > 2) pages.push('...');

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (end < lastPage - 1) pages.push('...');
    pages.push(lastPage);

    return pages;
  }

  function goTo(p: number) {
    if (p < 1 || p > lastPage || p === page) return;
    onPageChange?.(p);
  }

  let from = $derived(total === 0 ? 0 : (page - 1) * perPage + 1);
  let to = $derived(Math.min(page * perPage, total));
  let visiblePages = $derived(getVisiblePages());
</script>

{#if lastPage > 1}
  <nav class="svelar-pagination" aria-label="Pagination">
    {#if showInfo}
      <p class="svelar-pagination-info">
        Showing <strong>{from}</strong> to <strong>{to}</strong> of <strong>{total}</strong> results
      </p>
    {/if}

    <ul class="svelar-pagination-list">
      {#if showEnds}
        <li>
          <button
            class="svelar-pagination-btn"
            disabled={page === 1}
            onclick={() => goTo(1)}
            aria-label="First page"
          >
            ««
          </button>
        </li>
      {/if}

      <li>
        <button
          class="svelar-pagination-btn"
          disabled={page === 1}
          onclick={() => goTo(page - 1)}
          aria-label="Previous page"
        >
          «
        </button>
      </li>

      {#each visiblePages as p}
        {#if p === '...'}
          <li><span class="svelar-pagination-ellipsis">…</span></li>
        {:else}
          <li>
            <button
              class="svelar-pagination-btn"
              class:active={p === page}
              onclick={() => goTo(p as number)}
              aria-current={p === page ? 'page' : undefined}
            >
              {p}
            </button>
          </li>
        {/if}
      {/each}

      <li>
        <button
          class="svelar-pagination-btn"
          disabled={page === lastPage}
          onclick={() => goTo(page + 1)}
          aria-label="Next page"
        >
          »
        </button>
      </li>

      {#if showEnds}
        <li>
          <button
            class="svelar-pagination-btn"
            disabled={page === lastPage}
            onclick={() => goTo(lastPage)}
            aria-label="Last page"
          >
            »»
          </button>
        </li>
      {/if}
    </ul>
  </nav>
{/if}

<style>
  .svelar-pagination {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    margin: 1.5rem 0;
  }

  .svelar-pagination-info {
    font-size: 0.875rem;
    color: #6b7280;
    margin: 0;
  }

  .svelar-pagination-info strong {
    color: #111827;
    font-weight: 600;
  }

  .svelar-pagination-list {
    display: flex;
    list-style: none;
    margin: 0;
    padding: 0;
    gap: 0.25rem;
  }

  .svelar-pagination-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2.25rem;
    height: 2.25rem;
    padding: 0 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    background: white;
    color: #374151;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .svelar-pagination-btn:hover:not(:disabled):not(.active) {
    background: #f3f4f6;
    border-color: #9ca3af;
  }

  .svelar-pagination-btn.active {
    background: #3b82f6;
    border-color: #3b82f6;
    color: white;
  }

  .svelar-pagination-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .svelar-pagination-ellipsis {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2.25rem;
    height: 2.25rem;
    color: #6b7280;
  }
</style>
