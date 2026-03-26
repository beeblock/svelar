<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Alert } from '$lib/components/ui';

  let { data } = $props();

  const { form, errors, message, enhance, delayed } = superForm(data.form, {
    // Clear password on failed login
    onResult: ({ result }) => {
      if (result.type === 'failure') {
        $form.password = '';
      }
    },
  });
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
      {#if $message}
        <Alert variant="destructive">
          <span class="text-sm">{$message}</span>
        </Alert>
      {/if}

      <form method="POST" use:enhance class="space-y-4">
        <div class="space-y-2">
          <Label for="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            bind:value={$form.email}
            aria-invalid={$errors.email ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.email}
            <p class="text-sm text-red-600">{$errors.email[0]}</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="Your password"
            bind:value={$form.password}
            aria-invalid={$errors.password ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.password}
            <p class="text-sm text-red-600">{$errors.password[0]}</p>
          {/if}
        </div>

        <Button type="submit" class="w-full" disabled={$delayed}>
          {$delayed ? 'Signing in...' : 'Sign In'}
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
