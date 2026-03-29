<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Alert } from 'svelar/ui';
  import * as m from '$lib/paraglide/messages';
  import { localizeHref } from '$lib/paraglide/runtime';

  let { data } = $props();

  const { form, errors, message, enhance, delayed } = superForm(data.form);
</script>

<svelte:head>
  <title>{m.register_title()} — {m.app_name()}</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)]">
  <Card class="w-full max-w-md">
    <CardHeader>
      <CardTitle>{m.register_title()}</CardTitle>
      <CardDescription>{m.register_subtitle()}</CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      {#if $message}
        <Alert variant="destructive">
          <span class="text-sm">{$message}</span>
        </Alert>
      {/if}

      <form method="POST" use:enhance class="space-y-4">
        <div class="space-y-2">
          <Label for="name">{m.register_name()}</Label>
          <Input
            id="name"
            name="name"
            type="text"
            placeholder={m.register_name_placeholder()}
            bind:value={$form.name}
            aria-invalid={$errors.name ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.name}
            <p class="text-sm text-red-600">{$errors.name[0]}</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="email">{m.register_email()}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder={m.register_email_placeholder()}
            bind:value={$form.email}
            aria-invalid={$errors.email ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.email}
            <p class="text-sm text-red-600">{$errors.email[0]}</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="password">{m.register_password()}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder={m.register_password_placeholder()}
            bind:value={$form.password}
            aria-invalid={$errors.password ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.password}
            <p class="text-sm text-red-600">{$errors.password[0]}</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="password_confirmation">{m.register_confirm_password()}</Label>
          <Input
            id="password_confirmation"
            name="password_confirmation"
            type="password"
            placeholder={m.register_confirm_placeholder()}
            bind:value={$form.password_confirmation}
            aria-invalid={$errors.password_confirmation ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.password_confirmation}
            <p class="text-sm text-red-600">{$errors.password_confirmation[0]}</p>
          {/if}
        </div>

        <Button type="submit" class="w-full" disabled={$delayed}>
          {$delayed ? m.register_loading() : m.register_submit()}
        </Button>
      </form>
    </CardContent>

    <CardFooter class="border-t pt-6">
      <p class="text-sm text-center w-full text-gray-600">
        {m.register_has_account()}
        <a href={localizeHref('/login')} class="font-medium text-brand hover:underline">
          {m.register_login_link()}
        </a>
      </p>
    </CardFooter>
  </Card>
</div>
