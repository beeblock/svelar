export const authMiddleware = `import { Middleware, type MiddlewareContext, type NextFunction } from 'svelar/middleware';

export class AuthMiddleware extends Middleware {
  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    const token = ctx.event.request.headers.get('authorization')?.replace('Bearer ', '');

    if (!token) {
      return new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // TODO: Verify token and set user on locals
    // ctx.event.locals.user = await verifyToken(token);

    return next();
  }
}
`;

export const userModel = `import { Model } from 'svelar/orm';

export class User extends Model {
  static table = 'users';
  static timestamps = true;
  static fillable = ['name', 'email', 'password', 'email_verified_at'];
  static hidden = ['password'];

  declare id: number;
  declare name: string;
  declare email: string;
  declare password: string;
  declare email_verified_at: Date | null;
  declare created_at: Date;
  declare updated_at: Date;
}
`;

export const usersMigration = `import { Migration } from 'svelar/database';

export default class CreateUsersTable extends Migration {
  async up() {
    await this.schema.createTable('users', (table) => {
      table.increments('id');
      table.string('name');
      table.string('email').unique();
      table.string('password');
      table.timestamp('email_verified_at').nullable();
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('users');
  }
}
`;

export const loginPageSvelte = `<script>
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/index.js';
  import { Button } from '$lib/components/ui/Button.svelte';
  import { Input } from '$lib/components/ui/Input.svelte';
  import { Label } from '$lib/components/ui/Label.svelte';

  let email = $state('');
  let password = $state('');
  let loading = $state(false);
  let error = $state('');

  async function handleLogin(e: SubmitEvent) {
    e.preventDefault();
    loading = true;
    error = '';

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        error = 'Invalid email or password';
        return;
      }

      window.location.href = '/dashboard';
    } catch (e) {
      error = 'An error occurred. Please try again.';
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
  <div class="w-full max-w-md space-y-8">
    <div class="text-center">
      <h1 class="text-2xl font-bold text-gray-900">Welcome back</h1>
      <p class="mt-2 text-sm text-gray-600">Sign in to your account</p>
    </div>

    <Card>
      <CardContent class="pt-6">
        <form onsubmit={handleLogin} class="space-y-6">
          {#if error}
            <div class="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-900">
              {error}
            </div>
          {/if}

          <div>
            <Label for="email">Email address</Label>
            <Input
              id="email"
              type="email"
              name="email"
              required
              bind:value={email}
              placeholder="you@example.com"
              class="mt-1"
            />
          </div>

          <div>
            <Label for="password">Password</Label>
            <Input
              id="password"
              type="password"
              name="password"
              required
              bind:value={password}
              placeholder="••••••••"
              class="mt-1"
            />
          </div>

          <Button type="submit" disabled={loading} class="w-full">
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>

        <p class="mt-6 text-center text-sm text-gray-600">
          Don't have an account?
          <a href="/register" class="font-medium text-brand hover:text-brand-dark">Sign up</a>
        </p>

        <p class="mt-2 text-center text-sm text-gray-600">
          <a href="/forgot-password" class="font-medium text-brand hover:text-brand-dark">Forgot password?</a>
        </p>
      </CardContent>
    </Card>
  </div>
</div>
`;

export const registerPageSvelte = `<script>
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/index.js';
  import { Button } from '$lib/components/ui/Button.svelte';
  import { Input } from '$lib/components/ui/Input.svelte';
  import { Label } from '$lib/components/ui/Label.svelte';

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let passwordConfirm = $state('');
  let loading = $state(false);
  let error = $state('');

  async function handleRegister(e: SubmitEvent) {
    e.preventDefault();

    if (password !== passwordConfirm) {
      error = 'Passwords do not match';
      return;
    }

    loading = true;
    error = '';

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });

      if (!response.ok) {
        error = 'Registration failed. Please try again.';
        return;
      }

      window.location.href = '/login';
    } catch (e) {
      error = 'An error occurred. Please try again.';
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
  <div class="w-full max-w-md space-y-8">
    <div class="text-center">
      <h1 class="text-2xl font-bold text-gray-900">Create your account</h1>
      <p class="mt-2 text-sm text-gray-600">Join us today to get started</p>
    </div>

    <Card>
      <CardContent class="pt-6">
        <form onsubmit={handleRegister} class="space-y-6">
          {#if error}
            <div class="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-900">
              {error}
            </div>
          {/if}

          <div>
            <Label for="name">Full name</Label>
            <Input
              id="name"
              type="text"
              name="name"
              required
              bind:value={name}
              placeholder="John Doe"
              class="mt-1"
            />
          </div>

          <div>
            <Label for="email">Email address</Label>
            <Input
              id="email"
              type="email"
              name="email"
              required
              bind:value={email}
              placeholder="you@example.com"
              class="mt-1"
            />
          </div>

          <div>
            <Label for="password">Password</Label>
            <Input
              id="password"
              type="password"
              name="password"
              required
              bind:value={password}
              placeholder="••••••••"
              class="mt-1"
            />
          </div>

          <div>
            <Label for="passwordConfirm">Confirm password</Label>
            <Input
              id="passwordConfirm"
              type="password"
              name="passwordConfirm"
              required
              bind:value={passwordConfirm}
              placeholder="••••••••"
              class="mt-1"
            />
          </div>

          <Button type="submit" disabled={loading} class="w-full">
            {loading ? 'Creating account...' : 'Create account'}
          </Button>
        </form>

        <p class="mt-6 text-center text-sm text-gray-600">
          Already have an account?
          <a href="/login" class="font-medium text-brand hover:text-brand-dark">Sign in</a>
        </p>
      </CardContent>
    </Card>
  </div>
</div>
`;

export const forgotPasswordPageSvelte = `<script>
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/index.js';
  import { Button } from '$lib/components/ui/Button.svelte';
  import { Input } from '$lib/components/ui/Input.svelte';
  import { Label } from '$lib/components/ui/Label.svelte';
  import { Alert } from '$lib/components/ui/Alert.svelte';

  let email = $state('');
  let loading = $state(false);
  let sent = $state(false);
  let error = $state('');

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    loading = true;
    error = '';

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        error = 'An error occurred. Please try again.';
        return;
      }

      sent = true;
    } catch (e) {
      error = 'An error occurred. Please try again.';
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
  <div class="w-full max-w-md space-y-8">
    <div class="text-center">
      <h1 class="text-2xl font-bold text-gray-900">Reset your password</h1>
      <p class="mt-2 text-sm text-gray-600">We'll send you instructions to reset your password</p>
    </div>

    <Card>
      <CardContent class="pt-6">
        {#if sent}
          <Alert variant="success">
            <p class="font-medium">Check your email</p>
            <p class="text-sm">We've sent password reset instructions to {email}</p>
          </Alert>
        {:else}
          <form onsubmit={handleSubmit} class="space-y-6">
            {#if error}
              <Alert variant="destructive">
                {error}
              </Alert>
            {/if}

            <div>
              <Label for="email">Email address</Label>
              <Input
                id="email"
                type="email"
                name="email"
                required
                bind:value={email}
                placeholder="you@example.com"
                class="mt-1"
              />
            </div>

            <Button type="submit" disabled={loading} class="w-full">
              {loading ? 'Sending...' : 'Send reset link'}
            </Button>
          </form>
        {/if}

        <p class="mt-6 text-center text-sm text-gray-600">
          Remember your password?
          <a href="/login" class="font-medium text-brand hover:text-brand-dark">Sign in</a>
        </p>
      </CardContent>
    </Card>
  </div>
</div>
`;

export const logoutPageSvelte = `<script>
  import { onMount } from 'svelte';

  onMount(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  });
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50">
  <div class="text-center">
    <h1 class="text-2xl font-bold text-gray-900 mb-2">Logging out...</h1>
    <p class="text-gray-600">Please wait while we sign you out.</p>
  </div>
</div>
`;
