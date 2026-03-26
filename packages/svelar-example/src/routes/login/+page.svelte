<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Alert } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { localizeHref } from '$lib/paraglide/runtime';

  let { data } = $props();

  const { form, errors, message, enhance, delayed } = superForm(data.form, {
    onResult: ({ result }) => {
      if (result.type === 'failure') {
        $form.password = '';
      }
    },
  });
</script>

<svelte:head>
  <title>{m.login_title()} — {m.app_name()}</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)]">
  <Card class="w-full max-w-md">
    <CardHeader>
      <CardTitle>{m.login_title()}</CardTitle>
      <CardDescription>{m.login_subtitle()}</CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      {#if $message}
        <Alert variant="destructive">
          <span class="text-sm">{$message}</span>
        </Alert>
      {/if}

      <form method="POST" use:enhance class="space-y-4">
        <div class="space-y-2">
          <Label for="email">{m.login_email()}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder={m.login_email_placeholder()}
            bind:value={$form.email}
            aria-invalid={$errors.email ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.email}
            <p class="text-sm text-red-600">{$errors.email[0]}</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="password">{m.login_password()}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder={m.login_password_placeholder()}
            bind:value={$form.password}
            aria-invalid={$errors.password ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.password}
            <p class="text-sm text-red-600">{$errors.password[0]}</p>
          {/if}
        </div>

        <Button type="submit" class="w-full" disabled={$delayed}>
          {$delayed ? m.login_loading() : m.login_submit()}
        </Button>
      </form>
    </CardContent>

    <CardFooter class="flex-col gap-4 border-t pt-6">
      <p class="text-sm text-center text-gray-600">
        {m.login_no_account()}
        <a href={localizeHref('/register')} class="font-medium text-[var(--color-brand)] hover:underline">
          {m.login_register_link()}
        </a>
      </p>
      <a href={localizeHref('/forgot-password')} class="text-sm text-center text-gray-600 hover:text-gray-900">
        {m.login_forgot_password()}
      </a>
    </CardFooter>
  </Card>
</div>
