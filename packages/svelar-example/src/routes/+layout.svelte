<script lang="ts">
  import '../app.css';
  import { Button, Avatar, AvatarImage, AvatarFallback, Icon } from 'svelar/ui';
  import { toast } from '$lib/stores/toasts.svelte.ts';
  import Toaster from '$lib/components/Toaster.svelte';
  import LanguageSwitcher from 'svelar/i18n/LanguageSwitcher.svelte';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { locales, getLocale, localizeHref } from '$lib/paraglide/runtime';
  import { useSSE } from 'svelar/broadcasting/client';
  import LayoutGrid from 'lucide-svelte/icons/layout-grid';
  import CreditCard from 'lucide-svelte/icons/credit-card';
  import KeyRound from 'lucide-svelte/icons/key-round';
  import Users from 'lucide-svelte/icons/users';
  import Activity from 'lucide-svelte/icons/activity';
  import Shield from 'lucide-svelte/icons/shield';
  import Lock from 'lucide-svelte/icons/lock';
  import Briefcase from 'lucide-svelte/icons/briefcase';
  import Clock from 'lucide-svelte/icons/clock';
  import FileText from 'lucide-svelte/icons/file-text';
  import Menu from 'lucide-svelte/icons/menu';
  import X from 'lucide-svelte/icons/x';
  import LayoutDashboard from 'lucide-svelte/icons/layout-dashboard';
  import ShieldCheck from 'lucide-svelte/icons/shield-check';
  import type { Component } from 'svelte';

  let { data, children } = $props();
  let sidebarOpen = $state(false);

  // Subscribe to broadcast notifications and show toasts
  onMount(() => {
    const channel = useSSE('notifications');

    channel.listen('toast', (eventData: { variant?: string; title: string; description?: string }) => {
      const variant = (eventData.variant || 'info') as 'success' | 'error' | 'warning' | 'info';
      toast[variant](eventData.title, { description: eventData.description });
    });

    return () => channel.close();
  });

  const dashboardLinks: { href: string; label: () => string; icon: Component<any>; exact?: boolean }[] = [
    { href: '/dashboard', label: () => m.sidebar_overview(), icon: LayoutGrid, exact: true },
    { href: '/dashboard/billing', label: () => m.sidebar_billing(), icon: CreditCard },
    { href: '/dashboard/api-keys', label: () => m.sidebar_api_keys(), icon: KeyRound },
    { href: '/dashboard/team', label: () => m.sidebar_team(), icon: Users },
  ];

  const adminLinks: { href: string; label: () => string; icon: Component<any> }[] = [
    { href: '/admin?tab=overview', label: () => m.sidebar_system_health(), icon: Activity },
    { href: '/admin?tab=users', label: () => m.sidebar_users(), icon: Users },
    { href: '/admin?tab=roles', label: () => m.sidebar_roles(), icon: Shield },
    { href: '/admin?tab=permissions', label: () => m.sidebar_permissions(), icon: Lock },
    { href: '/admin?tab=queue', label: () => m.sidebar_queue(), icon: Briefcase },
    { href: '/admin?tab=scheduler', label: () => m.sidebar_scheduler(), icon: Clock },
    { href: '/admin?tab=logs', label: () => m.sidebar_logs(), icon: FileText },
  ];

  function getBarePath(): string {
    const path = page.url.pathname;
    const localePattern = /^\/[a-z]{2}(?=\/|$)/;
    return path.replace(localePattern, '') || '/';
  }

  function isActive(href: string, exact = false): boolean {
    const bare = getBarePath();
    if (exact) return bare === href;
    return bare === href || bare.startsWith(href + '/');
  }

  function isOnDashboard(): boolean {
    return getBarePath().startsWith('/dashboard');
  }

  function isOnAdmin(): boolean {
    return getBarePath().startsWith('/admin');
  }

  function hasSidebar(): boolean {
    return !!(data.user && (isOnDashboard() || isOnAdmin()));
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
      <div class="flex items-center gap-4 sm:gap-8">
        <!-- Mobile menu toggle -->
        {#if hasSidebar()}
          <button
            type="button"
            class="md:hidden p-1.5 -ml-1.5 rounded-md text-gray-600 hover:bg-gray-100"
            onclick={() => (sidebarOpen = !sidebarOpen)}
            aria-label="Toggle menu"
          >
            {#if sidebarOpen}
              <Icon icon={X} size={20} />
            {:else}
              <Icon icon={Menu} size={20} />
            {/if}
          </button>
        {/if}

        <a href={localizeHref('/')} class="flex items-center gap-2">
          <div class="w-8 h-8 bg-brand rounded-md flex items-center justify-center">
            <span class="text-white font-bold text-sm">S</span>
          </div>
          <span class="font-bold text-lg hidden sm:inline">{m.app_name()}</span>
        </a>
        <a href="/docs" class="hidden sm:inline text-gray-600 hover:text-gray-900 text-sm font-medium">Docs</a>
        {#if data.user}
          <a href={localizeHref('/dashboard')} class="hidden sm:inline text-gray-600 hover:text-gray-900 text-sm font-medium"
            >{m.nav_dashboard()}</a
          >
          {#if data.user.role === 'admin'}
            <a href={localizeHref('/admin')} class="hidden sm:inline text-gray-600 hover:text-gray-900 text-sm font-medium">{m.nav_admin()}</a>
          {/if}
        {/if}
      </div>

      <div class="flex items-center gap-2 sm:gap-4">
        <LanguageSwitcher {locales} {getLocale} {localizeHref} pathname={page.url.pathname} labels={{ en: 'EN', pt: 'PT', es: 'ES' }} />
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
          <a href={localizeHref('/register')} class="hidden sm:inline">
            <Button size="sm">{m.nav_register()}</Button>
          </a>
        {/if}
      </div>
    </div>
  </nav>

  <div class="flex flex-1 relative">
    <!-- Mobile sidebar overlay -->
    {#if hasSidebar() && sidebarOpen}
      <div class="fixed inset-0 z-40 md:hidden">
        <button
          type="button"
          class="absolute inset-0 bg-black/30"
          onclick={() => (sidebarOpen = false)}
          aria-label="Close menu"
        ></button>
        <aside class="relative z-50 w-64 h-full bg-white border-r border-gray-200 shadow-lg overflow-y-auto">
          <div class="p-6 space-y-8">
            {#if isOnDashboard()}
              <div>
                <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{m.nav_dashboard()}</h3>
                <nav class="space-y-1">
                  {#each dashboardLinks as link}
                    <a
                      href={localizeHref(link.href)}
                      onclick={() => (sidebarOpen = false)}
                      class="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors {isActive(link.href, link.exact)
                        ? 'bg-brand text-white'
                        : 'text-gray-700 hover:bg-gray-100'}"
                    >
                      <Icon icon={link.icon} size={18} />
                      {link.label()}
                    </a>
                  {/each}
                </nav>
              </div>
            {/if}

            {#if data.user?.role === 'admin' && isOnAdmin()}
              <div>
                <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{m.nav_admin()}</h3>
                <nav class="space-y-1">
                  {#each adminLinks as link}
                    {@const tabParam = new URL(link.href, 'http://x').searchParams.get('tab')}
                    {@const currentTab = page.url.searchParams.get('tab') ?? 'overview'}
                    <a
                      href={localizeHref(link.href)}
                      onclick={() => (sidebarOpen = false)}
                      class="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors {tabParam === currentTab
                        ? 'bg-brand text-white'
                        : 'text-gray-700 hover:bg-gray-100'}"
                    >
                      <Icon icon={link.icon} size={18} />
                      {link.label()}
                    </a>
                  {/each}
                </nav>
              </div>
            {/if}

            <!-- Mobile-only nav links -->
            {#if data.user}
              <div class="border-t border-gray-200 pt-4 sm:hidden">
                <nav class="space-y-1">
                  <a href={localizeHref('/dashboard')} onclick={() => (sidebarOpen = false)}
                    class="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-100">
                    <Icon icon={LayoutDashboard} size={18} /> {m.nav_dashboard()}
                  </a>
                  {#if data.user.role === 'admin'}
                    <a href={localizeHref('/admin')} onclick={() => (sidebarOpen = false)}
                      class="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-100">
                      <Icon icon={ShieldCheck} size={18} /> {m.nav_admin()}
                    </a>
                  {/if}
                </nav>
              </div>
            {/if}
          </div>
        </aside>
      </div>
    {/if}

    <!-- Desktop sidebar -->
    {#if hasSidebar()}
      <aside class="hidden md:block w-64 shrink-0 border-r border-gray-200 bg-white">
        <div class="sticky top-20 p-6 space-y-8">
          {#if isOnDashboard()}
            <div>
              <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{m.nav_dashboard()}</h3>
              <nav class="space-y-1">
                {#each dashboardLinks as link}
                  <a
                    href={localizeHref(link.href)}
                    class="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors {isActive(link.href, link.exact)
                      ? 'bg-brand text-white'
                      : 'text-gray-700 hover:bg-gray-100'}"
                  >
                    <Icon icon={link.icon} size={18} />
                    {link.label()}
                  </a>
                {/each}
              </nav>
            </div>
          {/if}

          {#if data.user.role === 'admin' && isOnAdmin()}
            <div>
              <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{m.nav_admin()}</h3>
              <nav class="space-y-1">
                {#each adminLinks as link}
                  {@const tabParam = new URL(link.href, 'http://x').searchParams.get('tab')}
                  {@const currentTab = page.url.searchParams.get('tab') ?? 'overview'}
                  <a
                    href={localizeHref(link.href)}
                    class="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors {tabParam === currentTab
                      ? 'bg-brand text-white'
                      : 'text-gray-700 hover:bg-gray-100'}"
                  >
                    <Icon icon={link.icon} size={18} />
                    {link.label()}
                  </a>
                {/each}
              </nav>
            </div>
          {/if}
        </div>
      </aside>
    {/if}

    <!-- Main Content -->
    <main class="flex-1 min-w-0">
      <div class="px-4 sm:px-6 lg:px-8 py-8">
        {@render children()}
      </div>
    </main>
  </div>

  <footer class="border-t border-gray-200 bg-white py-8 text-center text-sm text-gray-500">
    <p>&copy; 2024 {m.app_name()}. {m.footer_text()}</p>
  </footer>
</div>

<Toaster position="bottom-right" />

<style lang="postcss" global>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
</style>
