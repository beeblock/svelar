<script lang="ts">
  import { Button, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent } from 'svelar/ui';
  import * as m from '$lib/paraglide/messages';

  let { data } = $props();

  // Mock billing data
  let currentPlan = $state({
    name: 'Pro',
    price: 29,
    billingCycle: 'monthly',
    features: [
      'Unlimited posts',
      'API access',
      'Advanced analytics',
      'Priority support',
      'Custom domain',
    ],
  });

  let usageMeters = $state([
    {
      name: 'Posts Created',
      current: 234,
      limit: 1000,
      percentage: 23,
    },
    {
      name: 'API Calls',
      current: 15420,
      limit: 100000,
      percentage: 15,
    },
    {
      name: 'Storage',
      current: 2.4,
      limit: 50,
      unit: 'GB',
      percentage: 5,
    },
    {
      name: 'Team Members',
      current: 3,
      limit: 10,
      percentage: 30,
    },
  ]);

  let paymentHistory = $state([
    {
      id: 1,
      date: new Date('2024-03-01'),
      amount: 29.0,
      status: 'paid',
      invoice: 'INV-2024-001',
    },
    {
      id: 2,
      date: new Date('2024-02-01'),
      amount: 29.0,
      status: 'paid',
      invoice: 'INV-2024-002',
    },
    {
      id: 3,
      date: new Date('2024-01-01'),
      amount: 29.0,
      status: 'paid',
      invoice: 'INV-2024-003',
    },
  ]);

  const availablePlans = [
    {
      name: 'Free',
      price: 0,
      description: 'Great to get started',
      features: ['5 posts', 'Basic analytics', 'Community support'],
    },
    {
      name: 'Pro',
      price: 29,
      description: 'For growing teams',
      features: ['Unlimited posts', 'Advanced analytics', 'Priority support', 'API access'],
      current: true,
    },
    {
      name: 'Enterprise',
      price: 99,
      description: 'For large organizations',
      features: ['Everything in Pro', 'Custom integrations', 'Dedicated support', 'SSO'],
    },
  ];

  function formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
</script>

<svelte:head>
  <title>Billing — {m.app_name()}</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold text-gray-900">Billing & Subscription</h1>
    <p class="text-gray-600 mt-1">Manage your plan, usage, and payment methods</p>
  </div>

  <!-- Current Plan Section -->
  <Card>
    <CardHeader>
      <CardTitle>Current Plan</CardTitle>
      <CardDescription>You are on the Pro plan, renews on April 1, 2024</CardDescription>
    </CardHeader>
    <CardContent class="space-y-6">
      <div class="flex items-start justify-between">
        <div>
          <div class="flex items-center gap-2 mb-2">
            <h3 class="text-2xl font-bold text-gray-900">{currentPlan.name}</h3>
            <Badge variant="default">Active</Badge>
          </div>
          <p class="text-3xl font-bold text-[var(--color-brand)]">${currentPlan.price}<span class="text-lg text-gray-600">/{currentPlan.billingCycle}</span></p>
        </div>
        <Button>Manage Billing</Button>
      </div>

      <div>
        <h4 class="font-semibold text-gray-900 mb-3">Features Included</h4>
        <ul class="space-y-2">
          {#each currentPlan.features as feature}
            <li class="flex items-center gap-2 text-gray-700">
              <svg class="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
              {feature}
            </li>
          {/each}
        </ul>
      </div>
    </CardContent>
  </Card>

  <!-- Usage Meters -->
  <Card>
    <CardHeader>
      <CardTitle>Usage This Month</CardTitle>
      <CardDescription>Track your resource consumption</CardDescription>
    </CardHeader>
    <CardContent class="space-y-6">
      {#each usageMeters as meter}
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium text-gray-900">{meter.name}</span>
            <span class="text-sm text-gray-600">
              {meter.current}{meter.unit ? meter.unit : ''} / {meter.limit}{meter.unit ? meter.unit : ''}
            </span>
          </div>
          <div class="w-full bg-gray-200 rounded-full h-2">
            <div
              class="h-2 rounded-full transition-all"
              style="width: {meter.percentage}%; background-color: {meter.percentage > 80 ? '#ef4444' : meter.percentage > 50 ? '#f59e0b' : '#10b981'}"
            ></div>
          </div>
        </div>
      {/each}
    </CardContent>
  </Card>

  <!-- Plan Comparison -->
  <Card>
    <CardHeader>
      <CardTitle>Compare Plans</CardTitle>
      <CardDescription>Upgrade, downgrade, or switch plans anytime</CardDescription>
    </CardHeader>
    <CardContent>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        {#each availablePlans as plan}
          <div class="border border-gray-200 rounded-lg p-6 flex flex-col {plan.current ? 'ring-2 ring-[var(--color-brand)]' : ''}">
            <div class="flex items-start justify-between mb-4">
              <div>
                <h3 class="text-xl font-bold text-gray-900">{plan.name}</h3>
                <p class="text-sm text-gray-600 mt-1">{plan.description}</p>
              </div>
              {#if plan.current}
                <Badge variant="default">Current</Badge>
              {/if}
            </div>

            <div class="mb-6">
              <p class="text-3xl font-bold text-gray-900">${plan.price}</p>
              <p class="text-sm text-gray-600">/month</p>
            </div>

            <ul class="space-y-2 mb-6 flex-1">
              {#each plan.features as feature}
                <li class="text-sm text-gray-700 flex items-center gap-2">
                  <svg class="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                  </svg>
                  {feature}
                </li>
              {/each}
            </ul>

            <Button
              class="w-full"
              variant={plan.current ? 'outline' : 'default'}
              disabled={plan.current}
            >
              {plan.current ? 'Current Plan' : plan.price > currentPlan.price ? 'Upgrade' : 'Downgrade'}
            </Button>
          </div>
        {/each}
      </div>
    </CardContent>
  </Card>

  <!-- Payment History -->
  <Card>
    <CardHeader>
      <CardTitle>Payment History</CardTitle>
      <CardDescription>View your invoices and past payments</CardDescription>
    </CardHeader>
    <CardContent>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200">
              <th class="text-left py-3 px-4 font-semibold text-gray-900">Date</th>
              <th class="text-left py-3 px-4 font-semibold text-gray-900">Invoice</th>
              <th class="text-left py-3 px-4 font-semibold text-gray-900">Amount</th>
              <th class="text-left py-3 px-4 font-semibold text-gray-900">Status</th>
              <th class="text-left py-3 px-4 font-semibold text-gray-900">Action</th>
            </tr>
          </thead>
          <tbody>
            {#each paymentHistory as payment (payment.id)}
              <tr class="border-b border-gray-100 hover:bg-gray-50">
                <td class="py-3 px-4 text-gray-900">{formatDate(payment.date)}</td>
                <td class="py-3 px-4">
                  <a href="#" class="text-[var(--color-brand)] hover:underline font-medium">
                    {payment.invoice}
                  </a>
                </td>
                <td class="py-3 px-4 font-medium text-gray-900">${payment.amount.toFixed(2)}</td>
                <td class="py-3 px-4">
                  <Badge variant={payment.status === 'paid' ? 'default' : 'secondary'}>
                    {payment.status.charAt(0).toUpperCase() + payment.status.slice(1)}
                  </Badge>
                </td>
                <td class="py-3 px-4">
                  <Button size="sm" variant="outline">Download</Button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </CardContent>
  </Card>

  <!-- Payment Method -->
  <Card>
    <CardHeader>
      <CardTitle>Payment Method</CardTitle>
      <CardDescription>Update your billing information</CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <div class="p-4 border border-gray-200 rounded-lg bg-gray-50 flex items-center justify-between">
        <div class="flex items-center gap-4">
          <div class="w-12 h-8 bg-blue-600 rounded flex items-center justify-center text-white text-xs font-bold">
            VISA
          </div>
          <div>
            <p class="font-medium text-gray-900">Visa ending in 4242</p>
            <p class="text-sm text-gray-600">Expires 12/2025</p>
          </div>
        </div>
        <Button variant="outline" size="sm">Update</Button>
      </div>
    </CardContent>
  </Card>
</div>
