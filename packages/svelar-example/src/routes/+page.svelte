<script lang="ts">
  import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent } from 'svelar/ui';
  import * as m from '$lib/paraglide/messages';
  import { localizeHref } from '$lib/paraglide/runtime';

  let { data } = $props();
</script>

<svelte:head>
  <title>{m.app_name()} — {m.home_title()}</title>
</svelte:head>

<div class="space-y-12">
  <!-- Hero Section -->
  <div class="text-center space-y-6">
    <div class="inline-block px-4 py-2 bg-blue-100 rounded-full">
      <span class="text-sm font-medium text-blue-700">{m.home_badge()}</span>
    </div>

    <h1 class="text-5xl sm:text-6xl font-bold tracking-tight">
      <span class="text-gray-900">{m.home_build_with()}</span>
      <br />
      <span class="text-[var(--color-brand)]">{m.home_laravel_conventions()}</span>
    </h1>

    <p class="text-xl text-gray-600 max-w-2xl mx-auto">
      {m.home_subtitle()}
    </p>

    <div class="flex flex-wrap gap-4 justify-center pt-4">
      {#if data.user}
        <a href={localizeHref('/dashboard')}>
          <Button size="lg">{m.home_go_dashboard()}</Button>
        </a>
      {:else}
        <a href={localizeHref('/register')}>
          <Button size="lg">{m.home_get_started()}</Button>
        </a>
        <a href={localizeHref('/login')}>
          <Button variant="outline" size="lg">{m.nav_login()}</Button>
        </a>
      {/if}
    </div>
  </div>

  <!-- Features Grid -->
  <div class="space-y-6">
    <h2 class="text-3xl font-bold text-center">{m.home_features_title()}</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{m.home_feature_orm()}</CardTitle>
          <CardDescription>{m.home_feature_orm_desc()}</CardDescription>
        </CardHeader>
        <CardContent class="text-sm text-gray-600">
          {m.home_feature_orm_body()}
          <div class="mt-3 bg-gray-100 p-2 rounded text-xs font-mono text-[var(--color-brand)]">
            User.where('active', true).with('posts').get()
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{m.home_feature_auth()}</CardTitle>
          <CardDescription>{m.home_feature_auth_desc()}</CardDescription>
        </CardHeader>
        <CardContent class="text-sm text-gray-600">
          {m.home_feature_auth_body()}
          <div class="mt-3 bg-gray-100 p-2 rounded text-xs font-mono text-[var(--color-brand)]">
            auth.attempt(credentials, session)
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{m.home_feature_routing()}</CardTitle>
          <CardDescription>{m.home_feature_routing_desc()}</CardDescription>
        </CardHeader>
        <CardContent class="text-sm text-gray-600">
          {m.home_feature_routing_body()}
          <div class="mt-3 bg-gray-100 p-2 rounded text-xs font-mono text-[var(--color-brand)]">
            export const GET = ctrl.handle('index')
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{m.home_feature_validation()}</CardTitle>
          <CardDescription>{m.home_feature_validation_desc()}</CardDescription>
        </CardHeader>
        <CardContent class="text-sm text-gray-600">
          {m.home_feature_validation_body()}
          <div class="mt-3 bg-gray-100 p-2 rounded text-xs font-mono text-[var(--color-brand)]">
            await CreatePostRequest.validate(event)
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{m.home_feature_ddd()}</CardTitle>
          <CardDescription>{m.home_feature_ddd_desc()}</CardDescription>
        </CardHeader>
        <CardContent class="text-sm text-gray-600">
          {m.home_feature_ddd_body()}
          <div class="mt-3 bg-gray-100 p-2 rounded text-xs font-mono text-[var(--color-brand)]">
            Controller → DTO → Service → Action → Repository
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{m.home_feature_migrations()}</CardTitle>
          <CardDescription>{m.home_feature_migrations_desc()}</CardDescription>
        </CardHeader>
        <CardContent class="text-sm text-gray-600">
          {m.home_feature_migrations_body()}
          <div class="mt-3 bg-gray-100 p-2 rounded text-xs font-mono text-[var(--color-brand)]">
            npx svelar migrate
          </div>
        </CardContent>
      </Card>
    </div>
  </div>

  <!-- Quick Start -->
  <div class="space-y-6">
    <h2 class="text-3xl font-bold text-center">{m.home_quickstart_title()}</h2>
    <div class="max-w-2xl mx-auto space-y-3">
      <div class="flex gap-4 items-start">
        <div class="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--color-brand)] text-white flex items-center justify-center font-bold">1</div>
        <div>
          <h4 class="font-semibold">{m.home_step1()}</h4>
          <code class="text-sm bg-gray-100 px-2 py-1 rounded block mt-1">npx create-svelar my-app</code>
        </div>
      </div>
      <div class="flex gap-4 items-start">
        <div class="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--color-brand)] text-white flex items-center justify-center font-bold">2</div>
        <div>
          <h4 class="font-semibold">{m.home_step2()}</h4>
          <code class="text-sm bg-gray-100 px-2 py-1 rounded block mt-1">npx svelar migrate</code>
        </div>
      </div>
      <div class="flex gap-4 items-start">
        <div class="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--color-brand)] text-white flex items-center justify-center font-bold">3</div>
        <div>
          <h4 class="font-semibold">{m.home_step3()}</h4>
          <code class="text-sm bg-gray-100 px-2 py-1 rounded block mt-1">npx svelar db:seed</code>
        </div>
      </div>
      <div class="flex gap-4 items-start">
        <div class="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--color-brand)] text-white flex items-center justify-center font-bold">4</div>
        <div>
          <h4 class="font-semibold">{m.home_step4()}</h4>
          <code class="text-sm bg-gray-100 px-2 py-1 rounded block mt-1">npm run dev</code>
        </div>
      </div>
    </div>
  </div>

  <!-- API Section -->
  <div class="space-y-6">
    <h2 class="text-3xl font-bold text-center">{m.home_api_title()}</h2>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card>
        <CardHeader>
          <CardTitle class="text-lg">Auth</CardTitle>
        </CardHeader>
        <CardContent class="text-sm space-y-2 font-mono">
          <div><span class="font-bold text-green-600">POST</span> /api/auth/register</div>
          <div><span class="font-bold text-green-600">POST</span> /api/auth/login</div>
          <div><span class="font-bold text-orange-600">POST</span> /api/auth/logout</div>
          <div><span class="font-bold text-blue-600">GET</span> /api/auth/me</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-lg">Posts</CardTitle>
        </CardHeader>
        <CardContent class="text-sm space-y-2 font-mono">
          <div><span class="font-bold text-blue-600">GET</span> /api/posts</div>
          <div><span class="font-bold text-green-600">POST</span> /api/posts</div>
          <div><span class="font-bold text-blue-600">GET</span> /api/posts/:id</div>
          <div><span class="font-bold text-orange-600">PUT</span> /api/posts/:id</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-lg">System</CardTitle>
        </CardHeader>
        <CardContent class="text-sm space-y-2 font-mono">
          <div><span class="font-bold text-blue-600">GET</span> /api/health</div>
          <div><span class="font-bold text-blue-600">GET</span> /api/admin/stats</div>
          <div><span class="font-bold text-blue-600">GET</span> /api/admin/users</div>
        </CardContent>
      </Card>
    </div>
  </div>
</div>
