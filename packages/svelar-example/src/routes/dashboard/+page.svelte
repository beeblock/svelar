<script lang="ts">
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardContent, Badge, Alert } from '$lib/components/ui';

  let { data } = $props();
  let posts: any[] = $state(data.posts || []);
  let newTitle = $state('');
  let newBody = $state('');
  let message = $state('');
  let messageType = $state<'success' | 'error'>('success');

  async function createPost(e: Event) {
    e.preventDefault();
    message = '';

    const res = await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newTitle,
        body: newBody,
        published: true,
      }),
    });

    if (res.ok) {
      newTitle = '';
      newBody = '';
      message = 'Post created successfully!';
      messageType = 'success';
      await refreshPosts();
    } else {
      const resData = await res.json();
      message = `Error: ${resData.message || JSON.stringify(resData.errors)}`;
      messageType = 'error';
    }
  }

  async function deletePost(id: number) {
    if (confirm('Are you sure you want to delete this post?')) {
      await fetch(`/api/posts/${id}`, { method: 'DELETE' });
      await refreshPosts();
    }
  }

  async function togglePublished(post: any) {
    await fetch(`/api/posts/${post.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ published: !post.published }),
    });
    await refreshPosts();
  }

  async function refreshPosts() {
    const res = await fetch('/api/posts/mine');
    if (res.ok) posts = await res.json();
  }
</script>

<svelte:head>
  <title>Dashboard — Svelar</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold text-gray-900 mb-2">Dashboard</h1>
    <p class="text-gray-600">Welcome back, <span class="font-medium">{data.user.name}</span>!</p>
  </div>

  <!-- Posts Section -->
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-2xl font-bold">Your Posts</h2>
      <Badge variant="secondary">{posts.length}</Badge>
    </div>

    {#if posts.length === 0}
      <Card>
        <CardContent class="pt-8 text-center">
          <p class="text-gray-500 text-sm">No posts yet. Create your first one below!</p>
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
                      {post.published ? 'Published' : 'Draft'}
                    </Badge>
                  </div>
                  <p class="text-gray-600 text-sm">{post.body}</p>
                </div>
              </div>

              <div class="flex gap-2 mt-4">
                <Button
                  size="sm"
                  variant="outline"
                  onclick={() => togglePublished(post)}
                >
                  {post.published ? 'Unpublish' : 'Publish'}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onclick={() => deletePost(post.id)}
                >
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Create Post Section -->
  <div class="space-y-4">
    <h2 class="text-2xl font-bold">Create Post</h2>

    {#if message}
      <Alert variant={messageType === 'error' ? 'destructive' : 'success'}>
        <span class="text-sm">{message}</span>
      </Alert>
    {/if}

    <Card>
      <CardContent class="pt-6">
        <form onsubmit={createPost} class="space-y-4">
          <div class="space-y-2">
            <Label for="title">Post Title</Label>
            <Input
              id="title"
              type="text"
              placeholder="Enter post title (minimum 3 characters)"
              bind:value={newTitle}
              required
            />
          </div>

          <div class="space-y-2">
            <Label for="body">Post Content</Label>
            <textarea
              id="body"
              placeholder="Write your post content here (minimum 10 characters)"
              bind:value={newBody}
              rows="6"
              required
              class="flex min-h-[120px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            ></textarea>
          </div>

          <Button type="submit" class="w-full">Create Post</Button>
        </form>
      </CardContent>
    </Card>
  </div>
</div>
