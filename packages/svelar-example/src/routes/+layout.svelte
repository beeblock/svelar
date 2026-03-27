<script lang="ts">
  import '../app.css';
  import { Button, Avatar, AvatarImage, AvatarFallback } from 'svelar/ui';
  import LanguageSwitcher from 'svelar/i18n/LanguageSwitcher.svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { locales, getLocale, localizeHref } from '$lib/paraglide/runtime';

  let { data, children } = $props();
  let sidebarOpen = $state(false);

  const dashboardLinks = [
    { href: '/dashboard', label: 'Overview', icon: 'grid' },
    { href: '/dashboard/billing', label: 'Billing', icon: 'credit-card' },
    { href: '/dashboard/api-keys', label: 'API Keys', icon: 'key' },
    { href: '/dashboard/team', label: 'Team', icon: 'users' },
  ];

  const adminLinks = [
    { href: '/admin?tab=overview', label: 'System Health', icon: 'activity' },
    { href: '/admin?tab=users', label: 'Users', icon: 'users' },
    { href: '/admin?tab=queue', label: 'Queue Monitor', icon: 'briefcase' },
    { href: '/admin?tab=scheduler', label: 'Scheduler', icon: 'clock' },
    { href: '/admin?tab=logs', label: 'Logs', icon: 'file-text' },
  ];

  function isActive(href: string): boolean {
    return page.url.pathname === href || page.url.pathname.startsWith(href);
  }

  function getIcon(icon: string): string {
    const icons: Record<string, string> = {
      'grid': '▦',
      'credit-card': '💳',
      'key': '🔑',
      'users': '👥',
      'activity': '📊',
      'briefcase': '💼',
      'clock': '⏰',
      'file-text': '📄',
    };
    return icons[icon] || '•';
  }
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
    <div class="px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
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
        <LanguageSwitcher {locales} {getLocale} {localizeHref} pathname={page.url.pathname} labels={{ en: 'EN', pt: 'PT' }} />
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

  <div class="flex flex-1">
    <!-- Sidebar -->
    {#if data.user && (page.url.pathname.startsWith('/dashboard') || page.url.pathname.startsWith('/admin'))}
      <aside class="hidden md:block w-64 border-r border-gray-200 bg-white">
        <div class="sticky top-20 p-6 space-y-8">
          {#if page.url.pathname.startsWith('/dashboard')}
            <div>
              <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Dashboard</h3>
              <nav class="space-y-1">
                {#each dashboardLinks as link}
                  <a
                    href={localizeHref(link.href)}
                    class="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors {isActive(link.href)
                      ? 'bg-[var(--color-brand)] text-white'
                      : 'text-gray-700 hover:bg-gray-100'}"
                  >
                    <span>{getIcon(link.icon)}</span>
                    {link.label}
                  </a>
                {/each}
              </nav>
            </div>
          {/if}

          {#if data.user.role === 'admin' && page.url.pathname.startsWith('/admin')}
            <div>
              <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Administration</h3>
              <nav class="space-y-1">
                {#each adminLinks as link}
                  <a
                    href={localizeHref(link.href)}
                    class="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors {page.url.pathname === '/admin' && link.href === '/admin?tab=overview'
                      ? 'bg-[var(--color-brand)] text-white'
                      : isActive('/admin')
                        ? 'bg-[var(--color-brand)] text-white'
                        : 'text-gray-700 hover:bg-gray-100'}"
                  >
                    <span>{getIcon(link.icon)}</span>
                    {link.label}
                  </a>
                {/each}
              </nav>
            </div>
          {/if}
        </div>
      </aside>
    {/if}

    <!-- Main Content -->
    <main class="flex-1">
      <div class="px-4 sm:px-6 lg:px-8 py-8">
        {@render children()}
      </div>
    </main>
  </div>

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
