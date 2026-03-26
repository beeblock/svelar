<script lang="ts">
  import '../app.css';
  import { Button } from '$lib/components/ui';
  import { Avatar, AvatarImage, AvatarFallback } from '$lib/components/ui';
  import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';
  import * as m from '$lib/paraglide/messages';
  import { localizeHref } from '$lib/paraglide/runtime';

  let { data, children } = $props();
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div class="flex flex-col min-h-screen">
  <nav class="border-b border-gray-200 bg-white shadow-sm sticky top-0 z-50">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
      <div class="flex items-center gap-8">
        <a href={localizeHref('/')} class="flex items-center gap-2">
          <div class="w-8 h-8 bg-[var(--color-brand)] rounded-md flex items-center justify-center">
            <span class="text-white font-bold text-sm">S</span>
          </div>
          <span class="font-bold text-lg hidden sm:inline">{m.app_name()}</span>
        </a>
        {#if data.user}
          <a href={localizeHref('/dashboard')} class="text-gray-600 hover:text-gray-900 text-sm font-medium"
            >{m.nav_dashboard()}</a
          >
          {#if data.user.role === 'admin'}
            <a href={localizeHref('/admin')} class="text-gray-600 hover:text-gray-900 text-sm font-medium">{m.nav_admin()}</a>
          {/if}
        {/if}
      </div>

      <div class="flex items-center gap-4">
        <LanguageSwitcher />
        {#if data.user}
          <div class="flex items-center gap-3">
            <div class="text-right hidden sm:block">
              <p class="text-sm font-medium text-gray-900">{data.user.name}</p>
              <p class="text-xs text-gray-500 capitalize">{data.user.role}</p>
            </div>
            <Avatar>
              <AvatarImage src="https://api.dicebear.com/7.x/avataaars/svg?seed={data.user.id}" />
              <AvatarFallback>{data.user.name.substring(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          </div>
          <form method="POST" action="/logout">
            <Button type="submit" variant="ghost" size="sm">{m.nav_logout()}</Button>
          </form>
        {:else}
          <a href={localizeHref('/login')}>
            <Button variant="outline" size="sm">{m.nav_login()}</Button>
          </a>
          <a href={localizeHref('/register')}>
            <Button size="sm">{m.nav_register()}</Button>
          </a>
        {/if}
      </div>
    </div>
  </nav>

  <main class="flex-1">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {@render children()}
    </div>
  </main>

  <footer class="border-t border-gray-200 bg-white py-8 text-center text-sm text-gray-500">
    <p>&copy; 2024 {m.app_name()}. {m.footer_text()}</p>
  </footer>
</div>

<style lang="postcss" global>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
</style>
