<script lang="ts">
  import { apiFetch } from 'svelar/http';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Alert } from 'svelar/ui';

  let email = $state('');
  let error = $state('');
  let success = $state('');
  let loading = $state(false);

  async function handleForgotPassword(e: Event) {
    e.preventDefault();
    error = '';
    success = '';
    loading = true;

    try {
      const res = await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (res.ok) {
        success = 'Check your email for a password reset link.';
        email = '';
      } else {
        error = data.message || 'Something went wrong';
      }
    } catch (err) {
      error = 'Network error. Please try again.';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Forgot Password — Svelar</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)]">
  <Card class="w-full max-w-md">
    <CardHeader>
      <CardTitle>Reset Password</CardTitle>
      <CardDescription>Enter your email to receive a password reset link</CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      {#if error}
        <Alert variant="destructive">
          <span class="text-sm">{error}</span>
        </Alert>
      {/if}

      {#if success}
        <Alert variant="success">
          <span class="text-sm">{success}</span>
        </Alert>
      {/if}

      <form onsubmit={handleForgotPassword} class="space-y-4">
        <div class="space-y-2">
          <Label for="email">Email Address</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            bind:value={email}
            required
            disabled={loading}
          />
        </div>

        <Button type="submit" class="w-full" disabled={loading}>
          {loading ? 'Sending...' : 'Send Reset Link'}
        </Button>
      </form>
    </CardContent>

    <CardFooter class="flex-col gap-4 border-t pt-6">
      <p class="text-sm text-center text-gray-600">
        Remember your password?
        <a href="/login" class="font-medium text-brand hover:underline">
          Sign in
        </a>
      </p>
    </CardFooter>
  </Card>
</div>
