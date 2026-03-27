<script lang="ts">
  import { Button, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent, Alert } from 'svelar/ui';
  import * as m from '$lib/paraglide/messages';

  let { data } = $props();
</script>

<svelte:head>
  <title>Billing — {m.app_name()}</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold text-gray-900">Billing & Subscription</h1>
    <p class="text-gray-600 mt-1">Manage your plan and payment methods</p>
  </div>

  <Alert variant="default">
    <div class="space-y-3">
      <p class="font-medium">Enable the Stripe billing plugin</p>
      <p class="text-sm text-gray-600">
        Svelar ships with <code class="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">svelar-stripe</code> —
        a full-featured billing plugin with subscriptions, invoices, webhooks, and a customer portal.
        To enable it in this app:
      </p>

      <div class="space-y-2 mt-3">
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide">1. Add the dependency</p>
        <code class="block bg-gray-100 px-3 py-2 rounded text-sm font-mono">
          <!-- In your package.json dependencies -->
          "svelar-stripe": "*"
        </code>
      </div>

      <div class="space-y-2">
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide">2. Register the plugin in app.ts</p>
        <pre class="bg-gray-100 px-3 py-2 rounded text-sm font-mono overflow-x-auto text-gray-800">import {'{'} StripePlugin {'}'} from 'svelar-stripe';
import {'{'} PluginManager {'}'} from 'svelar/plugins';

const plugins = new PluginManager(app);
plugins.use(new StripePlugin());
await plugins.boot();</pre>
      </div>

      <div class="space-y-2">
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide">3. Set your environment variables</p>
        <pre class="bg-gray-100 px-3 py-2 rounded text-sm font-mono overflow-x-auto text-gray-800">STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...</pre>
      </div>

      <div class="space-y-2">
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide">4. Publish & run migrations</p>
        <code class="block bg-gray-100 px-3 py-2 rounded text-sm font-mono">
          npx svelar plugin:publish svelar-stripe && npm run migrate
        </code>
      </div>
    </div>
  </Alert>

  <!-- Preview of what billing looks like once configured -->
  <Card>
    <CardHeader>
      <CardTitle>Current Plan</CardTitle>
      <CardDescription>Your subscription details will appear here once the Stripe plugin is configured</CardDescription>
    </CardHeader>
    <CardContent class="space-y-6">
      <div class="flex items-start justify-between">
        <div>
          <div class="flex items-center gap-2 mb-2">
            <h3 class="text-2xl font-bold text-gray-400">Free</h3>
            <Badge variant="secondary">Plugin not enabled</Badge>
          </div>
          <p class="text-3xl font-bold text-gray-400">$0<span class="text-lg text-gray-300">/month</span></p>
        </div>
        <Button disabled>Manage Billing</Button>
      </div>
    </CardContent>
  </Card>

  <!-- What the plugin provides -->
  <Card>
    <CardHeader>
      <CardTitle>What svelar-stripe provides</CardTitle>
      <CardDescription>Everything you need for SaaS billing, out of the box</CardDescription>
    </CardHeader>
    <CardContent>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="space-y-3">
          <h4 class="font-semibold text-gray-900">Subscription Management</h4>
          <ul class="space-y-2 text-sm text-gray-600">
            <li class="flex items-center gap-2">
              <svg class="w-4 h-4 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
              Subscribe, upgrade, downgrade, cancel & resume
            </li>
            <li class="flex items-center gap-2">
              <svg class="w-4 h-4 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
              Trial periods & grace periods
            </li>
            <li class="flex items-center gap-2">
              <svg class="w-4 h-4 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
              Feature-gating via plan features
            </li>
          </ul>
        </div>
        <div class="space-y-3">
          <h4 class="font-semibold text-gray-900">Payments & Invoicing</h4>
          <ul class="space-y-2 text-sm text-gray-600">
            <li class="flex items-center gap-2">
              <svg class="w-4 h-4 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
              Stripe Checkout & Customer Portal
            </li>
            <li class="flex items-center gap-2">
              <svg class="w-4 h-4 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
              Invoice tracking with payment status
            </li>
            <li class="flex items-center gap-2">
              <svg class="w-4 h-4 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
              Webhook handling with signature verification
            </li>
          </ul>
        </div>
      </div>
    </CardContent>
  </Card>
</div>
