<script lang="ts">
  import { Button } from '$lib/components/ui';
  import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '$lib/components/ui';

  let { data } = $props();
</script>

<svelte:head>
  <title>Svelar — Laravel-inspired Framework for SvelteKit</title>
</svelte:head>

<div class="space-y-12">
  <!-- Hero Section -->
  <div class="text-center space-y-6">
    <div class="inline-block px-4 py-2 bg-blue-100 rounded-full">
      <span class="text-sm font-medium text-blue-700">Full-stack framework</span>
    </div>

    <h1 class="text-5xl sm:text-6xl font-bold tracking-tight">
      <span class="text-gray-900">Build with</span>
      <br />
      <span class="text-[var(--color-brand)]">Laravel conventions</span>
    </h1>

    <p class="text-xl text-gray-600 max-w-2xl mx-auto">
      Svelar brings Laravel's powerful patterns and developer experience to SvelteKit. Build
      full-stack applications with models, migrations, middleware, and more.
    </p>

    <div class="flex flex-wrap gap-4 justify-center pt-4">
      {#if data.user}
        <a href="/dashboard">
          <Button size="lg">Go to Dashboard</Button>
        </a>
      {:else}
        <a href="/register">
          <Button size="lg">Get Started</Button>
        </a>
        <a href="/login">
          <Button variant="outline" size="lg">Sign In</Button>
        </a>
      {/if}
    </div>
  </div>

  <!-- Features Grid -->
  <div class="space-y-6">
    <h2 class="text-3xl font-bold text-center">Powerful Features</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>ORM & Models</CardTitle>
          <CardDescription>Eloquent-style database abstraction</CardDescription>
        </CardHeader>
        <CardContent class="text-sm text-gray-600">
          Fluent query builder, relationships, eager loading, and pagination built-in.
          <div class="mt-3 bg-gray-100 p-2 rounded text-xs font-mono text-[var(--color-brand)]">
            User.where('active', true).with('posts').get()
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auth & Sessions</CardTitle>
          <CardDescription>Multiple authentication methods</CardDescription>
        </CardHeader>
        <CardContent class="text-sm text-gray-600">
          Session-based auth, JWT, API tokens. Register, login, logout out of the box.
          <div class="mt-3 bg-gray-100 p-2 rounded text-xs font-mono text-[var(--color-brand)]">
            auth.attempt(credentials, session)
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Controllers & Routing</CardTitle>
          <CardDescription>Framework patterns you know</CardDescription>
        </CardHeader>
        <CardContent class="text-sm text-gray-600">
          Laravel-style controllers with middleware, validation, and resource routing.
          <div class="mt-3 bg-gray-100 p-2 rounded text-xs font-mono text-[var(--color-brand)]">
            export const GET = ctrl.handle('index')
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Validation & DTOs</CardTitle>
          <CardDescription>Type-safe data transfer</CardDescription>
        </CardHeader>
        <CardContent class="text-sm text-gray-600">
          Zod-powered validation with FormRequest classes for confident data handling.
          <div class="mt-3 bg-gray-100 p-2 rounded text-xs font-mono text-[var(--color-brand)]">
            await CreatePostRequest.validate(event)
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>DDD Architecture</CardTitle>
          <CardDescription>Clean code organization</CardDescription>
        </CardHeader>
        <CardContent class="text-sm text-gray-600">
          Services, Actions, Repositories for clean, testable business logic layers.
          <div class="mt-3 bg-gray-100 p-2 rounded text-xs font-mono text-[var(--color-brand)]">
            Controller → DTO → Service → Action → Repository
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Migrations & Seeders</CardTitle>
          <CardDescription>Schema versioning built-in</CardDescription>
        </CardHeader>
        <CardContent class="text-sm text-gray-600">
          Database migrations with schema builder and seeders for demo data.
          <div class="mt-3 bg-gray-100 p-2 rounded text-xs font-mono text-[var(--color-brand)]">
            npx svelar migrate
          </div>
        </CardContent>
      </Card>
    </div>
  </div>

  <!-- Quick Start -->
  <div class="space-y-6">
    <h2 class="text-3xl font-bold text-center">Quick Start</h2>
    <div class="max-w-2xl mx-auto space-y-3">
      <div class="flex gap-4 items-start">
        <div
          class="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--color-brand)] text-white flex items-center justify-center font-bold"
        >
          1
        </div>
        <div>
          <h4 class="font-semibold">Create a project</h4>
          <code class="text-sm bg-gray-100 px-2 py-1 rounded block mt-1">
            npx create-svelar my-app
          </code>
        </div>
      </div>
      <div class="flex gap-4 items-start">
        <div
          class="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--color-brand)] text-white flex items-center justify-center font-bold"
        >
          2
        </div>
        <div>
          <h4 class="font-semibold">Run migrations</h4>
          <code class="text-sm bg-gray-100 px-2 py-1 rounded block mt-1">npx svelar migrate</code>
        </div>
      </div>
      <div class="flex gap-4 items-start">
        <div
          class="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--color-brand)] text-white flex items-center justify-center font-bold"
        >
          3
        </div>
        <div>
          <h4 class="font-semibold">Seed demo data</h4>
          <code class="text-sm bg-gray-100 px-2 py-1 rounded block mt-1">npx svelar db:seed</code>
        </div>
      </div>
      <div class="flex gap-4 items-start">
        <div
          class="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--color-brand)] text-white flex items-center justify-center font-bold"
        >
          4
        </div>
        <div>
          <h4 class="font-semibold">Start developing</h4>
          <code class="text-sm bg-gray-100 px-2 py-1 rounded block mt-1">npm run dev</code>
        </div>
      </div>
    </div>
  </div>

  <!-- API Section -->
  <div class="space-y-6">
    <h2 class="text-3xl font-bold text-center">API Endpoints</h2>
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
