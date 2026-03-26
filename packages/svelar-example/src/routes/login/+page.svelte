<script lang="ts">
  import { goto } from '$app/navigation';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Alert } from '$lib/components/ui';

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);

  async function handleLogin(e: Event) {
    e.preventDefault();
    error = '';
    loading = true;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.ok) {
        await goto('/dashboard');
      } else {
        error = data.message || 'Login failed';
      }
    } catch (err) {
      error = 'Network error';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Login — Svelar</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)]">
  <Card class="w-full max-w-md">
    <CardHeader>
      <CardTitle>Welcome Back</CardTitle>
      <CardDescription>Sign in to your Svelar account</CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      {#if error}
        <Alert variant="destructive">
          <span class="text-sm">{error}</span>
        </Alert>
      {/if}

      <form onsubmit={handleLogin} class="space-y-4">
        <div class="space-y-2">
          <Label for="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            bind:value={email}
            required
            disabled={loading}
          />
        </div>

        <div class="space-y-2">
          <Label for="password">Password</Label>
          <Input
            id="password"
            type="password"
            placeholder="Your password"
            bind:value={password}
            required
            disabled={loading}
          />
        </div>

        <Button type="submit" class="w-full" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </Button>
      </form>
    </CardContent>

    <CardFooter class="flex-col gap-4 border-t pt-6">
      <p class="text-sm text-center text-gray-600">
        Don't have an account?
        <a href="/register" class="font-medium text-[var(--color-brand)] hover:underline">
          Register here
        </a>
      </p>
      <a href="/forgot-password" class="text-sm text-center text-gray-600 hover:text-gray-900">
        Forgot your password?
      </a>
    </CardFooter>
  </Card>
</div>
