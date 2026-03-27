<script lang="ts">
  import { Button, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent, Alert } from 'svelar/ui';
  import * as m from '$lib/paraglide/messages';

  let { data } = $props();
</script>

<svelte:head>
  <title>{m.billing_title()} — {m.app_name()}</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold text-gray-900">{m.billing_title()}</h1>
    <p class="text-gray-600 mt-1">{m.billing_subtitle()}</p>
  </div>

  <Alert variant="default">
    <div class="space-y-3">
      <p class="font-medium">{m.billing_enable_title()}</p>
      <p class="text-sm text-gray-600">{m.billing_enable_desc()}</p>

      <div class="space-y-2 mt-3">
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide">1. {m.billing_step_dependency()}</p>
        <code class="block bg-gray-100 px-3 py-2 rounded text-sm font-mono">
          "svelar-stripe": "*"
        </code>
      </div>

      <div class="space-y-2">
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide">2. {m.billing_step_register()}</p>
        <pre class="bg-gray-100 px-3 py-2 rounded text-sm font-mono overflow-x-auto text-gray-800">import {'{'} StripePlugin {'}'} from 'svelar-stripe';
import {'{'} PluginManager {'}'} from 'svelar/plugins';

const plugins = new PluginManager(app);
plugins.use(new StripePlugin());
await plugins.boot();</pre>
      </div>

      <div class="space-y-2">
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide">3. {m.billing_step_env()}</p>
        <pre class="bg-gray-100 px-3 py-2 rounded text-sm font-mono overflow-x-auto text-gray-800">STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...</pre>
      </div>

      <div class="space-y-2">
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide">4. {m.billing_step_migrate()}</p>
        <code class="block bg-gray-100 px-3 py-2 rounded text-sm font-mono">
          npx svelar plugin:publish svelar-stripe && npm run migrate
        </code>
      </div>
    </div>
  </Alert>

  <!-- Preview of what billing looks like once configured -->
  <Card>
    <CardHeader>
      <CardTitle>{m.billing_current_plan()}</CardTitle>
      <CardDescription>{m.billing_plan_desc()}</CardDescription>
    </CardHeader>
    <CardContent class="space-y-6">
      <div class="flex items-start justify-between">
        <div>
          <div class="flex items-center gap-2 mb-2">
            <h3 class="text-2xl font-bold text-gray-400">{m.billing_free()}</h3>
            <Badge variant="secondary">{m.billing_not_enabled()}</Badge>
          </div>
          <p class="text-3xl font-bold text-gray-400">$0<span class="text-lg text-gray-300">/mo</span></p>
        </div>
        <Button disabled>{m.billing_manage()}</Button>
      </div>
    </CardContent>
  </Card>

  <!-- What the plugin provides -->
  <Card>
    <CardHeader>
      <CardTitle>{m.billing_features_title()}</CardTitle>
      <CardDescription>{m.billing_features_desc()}</CardDescription>
    </CardHeader>
    <CardContent>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="space-y-3">
          <h4 class="font-semibold text-gray-900">{m.billing_subscriptions()}</h4>
          <ul class="space-y-2 text-sm text-gray-600">
            <li class="flex items-center gap-2">
              <svg class="w-4 h-4 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
              {m.billing_sub_manage()}
            </li>
            <li class="flex items-center gap-2">
              <svg class="w-4 h-4 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
              {m.billing_sub_trials()}
            </li>
            <li class="flex items-center gap-2">
              <svg class="w-4 h-4 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
              {m.billing_sub_features()}
            </li>
          </ul>
        </div>
        <div class="space-y-3">
          <h4 class="font-semibold text-gray-900">{m.billing_payments()}</h4>
          <ul class="space-y-2 text-sm text-gray-600">
            <li class="flex items-center gap-2">
              <svg class="w-4 h-4 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
              {m.billing_pay_checkout()}
            </li>
            <li class="flex items-center gap-2">
              <svg class="w-4 h-4 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
              {m.billing_pay_invoices()}
            </li>
            <li class="flex items-center gap-2">
              <svg class="w-4 h-4 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
              {m.billing_pay_webhooks()}
            </li>
          </ul>
        </div>
      </div>
    </CardContent>
  </Card>
</div>
