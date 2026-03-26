<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardContent, Badge, Alert } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  let { data } = $props();
  let posts: any[] = $state(data.posts || []);

  const { form, errors, message, enhance, delayed, reset } = superForm(data.form, {
    onUpdated: ({ form: f }) => {
      if (f.valid && f.message) {
        posts = data.posts || [];
        reset();
      }
    },
  });
</script>

<svelte:head>
  <title>{m.dashboard_title()} — {m.app_name()}</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold text-gray-900 mb-2">{m.dashboard_title()}</h1>
    <p class="text-gray-600">{m.dashboard_welcome({ name: data.user.name })}</p>
  </div>

  <!-- Posts Section -->
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-2xl font-bold">{m.dashboard_your_posts()}</h2>
      <Badge variant="secondary">{posts.length}</Badge>
    </div>

    {#if posts.length === 0}
      <Card>
        <CardContent class="pt-8 text-center">
          <p class="text-gray-500 text-sm">{m.dashboard_no_posts()}</p>
        </CardContent>
      </Card>
    {:else}
      <div class="space-y-3">
        {#each posts as post (post.id)}
          <Card class="hover:shadow-md transition-shadow">
            <CardContent class="pt-6">
              <div class="flex items-start justify-between gap-4">
                <div class="flex-1">
                  <div class="flex items-center gap-2 mb-2">
                    <h3 class="font-semibold text-gray-900">{post.title}</h3>
                    <Badge variant={post.published ? 'success' : 'secondary'}>
                      {post.published ? m.dashboard_published() : m.dashboard_draft()}
                    </Badge>
                  </div>
                  <p class="text-gray-600 text-sm">{post.body}</p>
                </div>
              </div>

              <div class="flex gap-2 mt-4">
                <form method="POST" action="?/toggle">
                  <input type="hidden" name="postId" value={post.id} />
                  <Button size="sm" variant="outline" type="submit">
                    {post.published ? m.dashboard_unpublish() : m.dashboard_publish()}
                  </Button>
                </form>
                <form method="POST" action="?/delete" onsubmit={(e) => { if (!confirm(m.dashboard_confirm_delete())) e.preventDefault(); }}>
                  <input type="hidden" name="postId" value={post.id} />
                  <Button size="sm" variant="destructive" type="submit">
                    {m.dashboard_delete()}
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Create Post Section -->
  <div class="space-y-4">
    <h2 class="text-2xl font-bold">{m.dashboard_create_post()}</h2>

    {#if $message}
      <Alert variant={$message.includes('Error') || $message.includes('Failed') ? 'destructive' : 'success'}>
        <span class="text-sm">{$message}</span>
      </Alert>
    {/if}

    <Card>
      <CardContent class="pt-6">
        <form method="POST" action="?/create" use:enhance class="space-y-4">
          <div class="space-y-2">
            <Label for="title">{m.dashboard_post_title()}</Label>
            <Input
              id="title"
              name="title"
              type="text"
              placeholder={m.dashboard_post_title_placeholder()}
              bind:value={$form.title}
              aria-invalid={$errors.title ? 'true' : undefined}
            />
            {#if $errors.title}
              <p class="text-sm text-red-600">{$errors.title[0]}</p>
            {/if}
          </div>

          <div class="space-y-2">
            <Label for="body">{m.dashboard_post_content()}</Label>
            <textarea
              id="body"
              name="body"
              placeholder={m.dashboard_post_content_placeholder()}
              bind:value={$form.body}
              rows="6"
              class="flex min-h-[120px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              class:border-red-500={$errors.body}
            ></textarea>
            {#if $errors.body}
              <p class="text-sm text-red-600">{$errors.body[0]}</p>
            {/if}
          </div>

          <input type="hidden" name="published" value="true" />

          <Button type="submit" class="w-full" disabled={$delayed}>
            {$delayed ? m.dashboard_creating() : m.dashboard_create_submit()}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</div>
