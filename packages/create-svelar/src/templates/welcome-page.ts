export const welcomePage = `<script>
  import { Button } from '$lib/components/ui/Button.svelte';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/index.js';
  import { Badge } from '$lib/components/ui/Badge.svelte';
</script>

<div class="min-h-screen bg-gradient-to-br from-brand-light to-gray-50">
  <div class="max-w-4xl mx-auto px-4 py-16 sm:py-24">
    <!-- Header -->
    <div class="text-center mb-12">
      <h1 class="text-5xl font-bold text-gray-900 mb-4">Welcome to Svelar</h1>
      <p class="text-xl text-gray-600 mb-2">Laravel-inspired framework for SvelteKit 2</p>
      <Badge class="mx-auto">Built with latest tools</Badge>
    </div>

    <!-- Quick Links -->
    <div class="grid md:grid-cols-3 gap-6 mb-12">
      <Card>
        <CardHeader>
          <CardTitle class="text-lg">Authentication</CardTitle>
        </CardHeader>
        <CardContent>
          <p class="text-gray-600 mb-4">Full auth scaffolding with login, register, and password reset pages</p>
          <Button variant="outline" size="sm">
            <a href="/login">Go to Login</a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-lg">Admin Dashboard</CardTitle>
        </CardHeader>
        <CardContent>
          <p class="text-gray-600 mb-4">Complete admin panel with user management and statistics</p>
          <Button variant="outline" size="sm">
            <a href="/admin">View Dashboard</a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-lg">UI Components</CardTitle>
        </CardHeader>
        <CardContent>
          <p class="text-gray-600 mb-4">Pre-built shadcn-style components with Tailwind CSS</p>
          <Button variant="outline" size="sm">View Components</Button>
        </CardContent>
      </Card>
    </div>

    <!-- Getting Started -->
    <Card class="mb-12">
      <CardHeader>
        <CardTitle>Getting Started</CardTitle>
      </CardHeader>
      <CardContent>
        <ol class="space-y-3 text-gray-700">
          <li class="flex items-start">
            <span class="font-bold mr-3 text-brand">1</span>
            <span>Create a model: <code class="bg-gray-100 px-2 py-1 rounded text-sm">npx svelar make:model User -a</code></span>
          </li>
          <li class="flex items-start">
            <span class="font-bold mr-3 text-brand">2</span>
            <span>Run migrations: <code class="bg-gray-100 px-2 py-1 rounded text-sm">npx svelar migrate</code></span>
          </li>
          <li class="flex items-start">
            <span class="font-bold mr-3 text-brand">3</span>
            <span>Start building your app!</span>
          </li>
        </ol>
      </CardContent>
    </Card>

    <!-- Features -->
    <div class="grid md:grid-cols-2 gap-6">
      <div>
        <h3 class="text-xl font-bold text-gray-900 mb-3">Features Included</h3>
        <ul class="space-y-2 text-gray-700">
          <li class="flex items-center">
            <span class="text-brand mr-2">✓</span>
            Tailwind CSS v4 with custom theme
          </li>
          <li class="flex items-center">
            <span class="text-brand mr-2">✓</span>
            shadcn-svelte UI components
          </li>
          <li class="flex items-center">
            <span class="text-brand mr-2">✓</span>
            Complete authentication system
          </li>
          <li class="flex items-center">
            <span class="text-brand mr-2">✓</span>
            Role-based permissions
          </li>
          <li class="flex items-center">
            <span class="text-brand mr-2">✓</span>
            Admin dashboard
          </li>
          <li class="flex items-center">
            <span class="text-brand mr-2">✓</span>
            DDD directory structure
          </li>
        </ul>
      </div>

      <div>
        <h3 class="text-xl font-bold text-gray-900 mb-3">Next Steps</h3>
        <ul class="space-y-2 text-gray-700">
          <li class="flex items-center">
            <span class="text-brand mr-2">→</span>
            <a href="https://svelar.dev" target="_blank" class="text-brand hover:text-brand-dark">Read the documentation</a>
          </li>
          <li class="flex items-center">
            <span class="text-brand mr-2">→</span>
            <a href="/admin" class="text-brand hover:text-brand-dark">View admin dashboard</a>
          </li>
          <li class="flex items-center">
            <span class="text-brand mr-2">→</span>
            <a href="/login" class="text-brand hover:text-brand-dark">Test authentication</a>
          </li>
        </ul>
      </div>
    </div>
  </div>
</div>
`;

export const layoutPage = `<script>
  let { children } = $props();
</script>

{@render children()}
`;
