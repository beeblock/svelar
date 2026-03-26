<script lang="ts">
  import { goto } from '$app/navigation';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Alert } from '$lib/components/ui';

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let password_confirmation = $state('');
  let errors: Record<string, string[]> = $state({});
  let error = $state('');
  let loading = $state(false);

  async function handleRegister(e: Event) {
    e.preventDefault();
    errors = {};
    error = '';
    loading = true;

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, password_confirmation }),
      });

      const data = await res.json();

      if (res.ok) {
        await goto('/dashboard');
      } else if (data.errors) {
        errors = data.errors;
      } else {
        error = data.message || 'Registration failed';
      }
    } catch (err) {
      error = 'Network error';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Register — Svelar</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)]">
  <Card class="w-full max-w-md">
    <CardHeader>
      <CardTitle>Create Account</CardTitle>
      <CardDescription>Get started with Svelar</CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      {#if error}
        <Alert variant="destructive">
          <span class="text-sm">{error}</span>
        </Alert>
      {/if}

      <form onsubmit={handleRegister} class="space-y-4">
        <div class="space-y-2">
          <Label for="name">Full Name</Label>
          <Input
            id="name"
            type="text"
            placeholder="Your name"
            bind:value={name}
            required
            disabled={loading}
          />
          {#if errors.name}
            <p class="text-sm text-red-600">{errors.name[0]}</p>
          {/if}
        </div>

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
          {#if errors.email}
            <p class="text-sm text-red-600">{errors.email[0]}</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="password">Password</Label>
          <Input
            id="password"
            type="password"
            placeholder="Min 8 characters"
            bind:value={password}
            required
            disabled={loading}
          />
          {#if errors.password}
            <p class="text-sm text-red-600">{errors.password[0]}</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="password_confirmation">Confirm Password</Label>
          <Input
            id="password_confirmation"
            type="password"
            placeholder="Repeat password"
            bind:value={password_confirmation}
            required
            disabled={loading}
          />
          {#if errors.password_confirmation}
            <p class="text-sm text-red-600">{errors.password_confirmation[0]}</p>
          {/if}
        </div>

        <Button type="submit" class="w-full" disabled={loading}>
          {loading ? 'Creating account...' : 'Create Account'}
        </Button>
      </form>
    </CardContent>

    <CardFooter class="border-t pt-6">
      <p class="text-sm text-center w-full text-gray-600">
        Already have an account?
        <a href="/login" class="font-medium text-[var(--color-brand)] hover:underline">
          Sign in
        </a>
      </p>
    </CardFooter>
  </Card>
</div>
