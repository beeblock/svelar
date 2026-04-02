# Charts Plugin

A server-side chart data query builder and SVG chart component library for Svelar/SvelteKit. Query your database for chart-ready data with grouping, aggregation, and trend analysis, then render it with zero-dependency SVG chart components.

**Package:** `@beeblock/svelar-charts`

**Install:**

```bash
npm install @beeblock/svelar-charts
```

**Imports:**

```ts
// Plugin registration
import { SvelarChartsPlugin } from '@beeblock/svelar-charts/server';

// Core API
import { ChartQuery, ChartDataBuilder } from '@beeblock/svelar-charts';

// Server-side (controller)
import { ChartController } from '@beeblock/svelar-charts/server';

// UI components
import { BarChart, LineChart, PieChart, DoughnutChart, AreaChart, SparkLine, StatCard, ChartCanvas, Tooltip, Legend } from '@beeblock/svelar-charts/ui';

// Types
import type { ChartData, ChartDataset, TrendChartData, TrendDirection, DateGrouping, BaseChartProps, BarChartProps, LineChartProps, PieChartProps, DoughnutChartProps, AreaChartProps, SparkLineProps, StatCardProps, SvelarChartsConfig } from '@beeblock/svelar-charts';
```

---

## Quick Start

### 1. Register the Plugin

```ts
// src/lib/plugins.ts
import { SvelarChartsPlugin } from '@beeblock/svelar-charts/server';

export const chartsPlugin = new SvelarChartsPlugin({
  prefix: '/api',
  defaultColors: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'],
  animate: true,
});
```

### 2. Query Data and Render a Chart

```ts
// src/routes/dashboard/+page.server.ts
import { ChartQuery } from '@beeblock/svelar-charts';

export async function load() {
  const usersPerMonth = await ChartQuery.table('users')
    .count()
    .groupBy('month', 'created_at')
    .period('2026-01-01', '2026-12-31')
    .label('New Users')
    .get();

  return { usersPerMonth };
}
```

```svelte
<!-- src/routes/dashboard/+page.svelte -->
<script lang="ts">
  import { BarChart } from '@beeblock/svelar-charts/ui';

  interface Props {
    data: { usersPerMonth: import('@beeblock/svelar-charts').ChartData };
  }
  let { data }: Props = $props();
</script>

<BarChart data={data.usersPerMonth} height={300} />
```

---

## Configuration

The `SvelarChartsPlugin` constructor accepts:

| Option | Type | Default | Description |
|---|---|---|---|
| `prefix` | `string` | `'/api'` | API route prefix |
| `defaultColors` | `string[]` | 10-color palette | Default chart colors |
| `animate` | `boolean` | `true` | Enable chart animations |

Default color palette: `#3B82F6` (blue), `#10B981` (emerald), `#F59E0B` (amber), `#EF4444` (red), `#8B5CF6` (violet), `#EC4899` (pink), `#06B6D4` (cyan), `#F97316` (orange), `#14B8A6` (teal), `#6366F1` (indigo).

---

## Core API

### ChartQuery

A fluent query builder that generates chart-ready data from database tables. Uses the Svelar `Connection` under the hood.

```ts
import { ChartQuery } from '@beeblock/svelar-charts';
```

**Factory:**

```ts
const query = ChartQuery.table('orders');
```

**Fluent methods:**

| Method | Returns | Description |
|---|---|---|
| `.table(name)` | `ChartQuery` | Static factory -- start a new query on a table |
| `.connection(name)` | `this` | Use a named database connection |
| `.select(expr)` | `this` | Set a custom SQL select expression |
| `.label(name)` | `this` | Set the dataset label |
| `.count()` | `this` | Aggregate with `COUNT(*)` |
| `.sum(column)` | `this` | Aggregate with `SUM(column)` |
| `.avg(column)` | `this` | Aggregate with `AVG(column)` |
| `.groupBy(column)` | `this` | Group by a column (e.g. `'role'`, `'status'`) |
| `.groupBy(interval, dateColumn)` | `this` | Group by date interval (`'day'`, `'week'`, `'month'`, `'quarter'`, `'year'`) |
| `.where(column, value)` | `this` | Add a WHERE clause (`=` operator) |
| `.where(column, operator, value)` | `this` | Add a WHERE clause with custom operator |
| `.period(start, end)` | `this` | Filter to a date range (inclusive) |
| `.compareWith(previousPeriod?)` | `this` | Compare with the previous period (for trends) |
| `.get()` | `Promise<ChartData>` | Execute and return `{ labels, datasets }` |
| `.trend(interval, days)` | `Promise<TrendChartData>` | Execute with trend comparison |

**Examples:**

```ts
// Count users by role
const usersByRole = await ChartQuery.table('users')
  .count()
  .groupBy('role')
  .label('Users')
  .get();
// => { labels: ['admin', 'editor', 'user'], datasets: [{ label: 'Users', data: [5, 12, 89] }] }

// Monthly revenue over a year
const revenue = await ChartQuery.table('orders')
  .sum('total')
  .groupBy('month', 'created_at')
  .period('2026-01-01', '2026-12-31')
  .where('status', 'completed')
  .label('Revenue')
  .get();

// Trend: new users in the last 30 days vs. the previous 30 days
const trend = await ChartQuery.table('users')
  .count()
  .label('New Users')
  .trend('day', 30);
// => { labels, datasets, change: 15.2, direction: 'up', currentValue: 142, previousValue: 123 }
```

**Date grouping intervals (`DateGrouping`):**

| Interval | SQL Expression | Label Format |
|---|---|---|
| `'day'` | `strftime('%Y-%m-%d', ...)` | `'Jan 15'` |
| `'week'` | `strftime('%Y-W%W', ...)` | `'W05'` |
| `'month'` | `strftime('%Y-%m', ...)` | `'Jan'` |
| `'quarter'` | derived | `'Q1'` |
| `'year'` | `strftime('%Y', ...)` | `'2026'` |

### ChartData

The standard data structure consumed by all chart components:

```ts
interface ChartData {
  labels: string[];
  datasets: ChartDataset[];
}

interface ChartDataset {
  label?: string;
  data: number[];
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  hidden?: boolean;
}
```

### TrendChartData

Extended `ChartData` with period comparison info:

```ts
interface TrendChartData extends ChartData {
  change: number;          // percentage change (e.g. 15.2 or -8.3)
  direction: 'up' | 'down' | 'flat';
  currentValue: number;    // total for the current period
  previousValue: number;   // total for the previous period
}
```

### ChartDataBuilder

Manually construct `ChartData` when you already have the data:

```ts
import { ChartDataBuilder } from '@beeblock/svelar-charts';

// Fluent builder
const data = new ChartDataBuilder()
  .labels(['Jan', 'Feb', 'Mar', 'Apr'])
  .dataset('Revenue', [1200, 1800, 2400, 2100], { color: '#3B82F6' })
  .dataset('Expenses', [800, 900, 1100, 950], { color: '#EF4444' })
  .build();

// From a key-value map
const pie = ChartDataBuilder.fromMap(
  { Chrome: 65, Firefox: 15, Safari: 12, Other: 8 },
  'Browser Share',
);

// From an array of objects
const bar = ChartDataBuilder.fromArray(
  products,
  'name',    // label key
  'sales',   // value key
  'Product Sales',
);
```

---

## Server-Side

### ChartController

Provides static methods for serving chart data as JSON:

```ts
// src/routes/api/charts/users/+server.ts
import { ChartController } from '@beeblock/svelar-charts/server';
import { ChartQuery } from '@beeblock/svelar-charts';

// Serve a pre-built query
export const GET = async (event) => {
  const query = ChartQuery.table('users')
    .count()
    .groupBy('month', 'created_at')
    .period('2026-01-01', '2026-12-31')
    .label('Users');

  return ChartController.serve(query);
};
```

```ts
// Serve trend data
export const GET = async (event) => {
  const query = ChartQuery.table('orders')
    .sum('total')
    .label('Revenue');

  return ChartController.serveTrend(query, 'month', 90);
};
```

```ts
// Generic handler with dynamic query params
export const GET = async (event) => {
  return ChartController.handle(event, (query, params) => {
    const groupBy = params.get('group_by') || 'month';
    return query.count().groupBy(groupBy, 'created_at');
  });
};
```

| Method | Description |
|---|---|
| `ChartController.serve(query)` | Execute a ChartQuery and return JSON response |
| `ChartController.serveTrend(query, interval, days)` | Execute a trend query and return JSON response |
| `ChartController.handle(event, builder)` | Generic handler that builds a query from URL params |

---

## UI Components

All chart components render pure SVG with no external dependencies.

### BarChart

```svelte
<script lang="ts">
  import { BarChart } from '@beeblock/svelar-charts/ui';
</script>

<BarChart
  data={chartData}
  height={300}
  width={600}
  horizontal={false}
  stacked={false}
  barRadius={4}
  barGap={4}
  showValues={false}
  showLegend={true}
  animate={true}
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `data` | `ChartData` | required | Chart data |
| `height` | `number` | `300` | Chart height in pixels |
| `width` | `number` | `600` | Chart width in pixels |
| `colors` | `string[]` | default palette | Bar colors |
| `className` | `string` | `''` | CSS class |
| `animate` | `boolean` | `true` | Enable animations |
| `horizontal` | `boolean` | `false` | Horizontal bar layout |
| `stacked` | `boolean` | `false` | Stack bars |
| `barRadius` | `number` | `4` | Bar corner radius |
| `barGap` | `number` | `4` | Gap between bars |
| `showValues` | `boolean` | `false` | Display values on bars |
| `showLegend` | `boolean` | `true` | Show legend |

### LineChart

```svelte
<script lang="ts">
  import { LineChart } from '@beeblock/svelar-charts/ui';
</script>

<LineChart
  data={chartData}
  height={300}
  smooth={false}
  showArea={false}
  showDots={true}
  dotRadius={4}
  strokeWidth={2}
  showLegend={true}
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `data` | `ChartData` | required | Chart data |
| `height` | `number` | `300` | Height in pixels |
| `width` | `number` | `600` | Width in pixels |
| `colors` | `string[]` | default palette | Line colors |
| `className` | `string` | `''` | CSS class |
| `animate` | `boolean` | `true` | Enable animations |
| `smooth` | `boolean` | `false` | Smooth (bezier) lines |
| `showArea` | `boolean` | `false` | Fill area under lines |
| `showDots` | `boolean` | `true` | Show data point dots |
| `dotRadius` | `number` | `4` | Dot radius |
| `strokeWidth` | `number` | `2` | Line stroke width |
| `showLegend` | `boolean` | `true` | Show legend |

### PieChart

```svelte
<PieChart
  data={chartData}
  size={300}
  showLabels={true}
  showPercentages={true}
  donut={false}
  donutWidth={60}
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `data` | `ChartData` | required | Chart data |
| `size` | `number` | `undefined` | Chart diameter |
| `colors` | `string[]` | default palette | Slice colors |
| `donut` | `boolean` | `false` | Render as donut |
| `donutWidth` | `number` | `undefined` | Donut ring width |
| `showLabels` | `boolean` | `false` | Show labels |
| `showPercentages` | `boolean` | `false` | Show percentage values |
| `className` | `string` | `''` | CSS class |
| `animate` | `boolean` | `true` | Enable animations |

### DoughnutChart

```svelte
<DoughnutChart
  data={chartData}
  size={300}
  ringWidth={60}
  showLabels={true}
  showPercentages={true}
  centerLabel="Total"
  centerValue="1,234"
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `data` | `ChartData` | required | Chart data |
| `size` | `number` | `undefined` | Chart diameter |
| `colors` | `string[]` | default palette | Ring colors |
| `ringWidth` | `number` | `undefined` | Ring width |
| `showLabels` | `boolean` | `false` | Show labels |
| `showPercentages` | `boolean` | `false` | Show percentage values |
| `centerLabel` | `string` | `undefined` | Center text label |
| `centerValue` | `string` | `undefined` | Center text value |
| `className` | `string` | `''` | CSS class |
| `animate` | `boolean` | `true` | Enable animations |

### AreaChart

```svelte
<AreaChart
  data={chartData}
  height={300}
  gradient={true}
  smooth={true}
  fillOpacity={0.3}
  showDots={true}
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `data` | `ChartData` | required | Chart data |
| `height` | `number` | `undefined` | Height in pixels |
| `width` | `number` | `undefined` | Width in pixels |
| `colors` | `string[]` | default palette | Area colors |
| `className` | `string` | `''` | CSS class |
| `animate` | `boolean` | `true` | Enable animations |
| `gradient` | `boolean` | `false` | Use gradient fill |
| `smooth` | `boolean` | `false` | Smooth lines |
| `showDots` | `boolean` | `false` | Show data point dots |
| `dotRadius` | `number` | `undefined` | Dot radius |
| `strokeWidth` | `number` | `undefined` | Line stroke width |
| `fillOpacity` | `number` | `undefined` | Area fill opacity (0-1) |

### SparkLine

A minimal inline chart for dashboards and tables:

```svelte
<SparkLine
  data={[10, 15, 8, 22, 18, 25, 30]}
  width={120}
  height={32}
  color="#3B82F6"
  strokeWidth={1.5}
  showEndDot={true}
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `data` | `number[]` | required | Array of numeric values |
| `width` | `number` | `undefined` | Width in pixels |
| `height` | `number` | `undefined` | Height in pixels |
| `color` | `string` | `undefined` | Line color |
| `strokeWidth` | `number` | `undefined` | Line stroke width |
| `showEndDot` | `boolean` | `false` | Show a dot at the last data point |
| `className` | `string` | `''` | CSS class |

### StatCard

A stat card with title, value, trend indicator, and optional sparkline:

```svelte
<StatCard
  title="Total Revenue"
  value="$12,345"
  change={15.2}
  trend="up"
  sparkData={[100, 120, 115, 140, 155, 170]}
  sparkColor="#10B981"
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `title` | `string` | required | Card title |
| `value` | `string` | required | Formatted value to display |
| `change` | `number` | `undefined` | Percentage change |
| `trend` | `'up' \| 'down' \| 'flat'` | `undefined` | Trend direction |
| `sparkData` | `number[]` | `undefined` | Data for inline sparkline |
| `sparkColor` | `string` | `'#3B82F6'` | Sparkline color |
| `icon` | `any` | `undefined` | Icon component (Lucide or Tabler) |
| `className` | `string` | `''` | CSS class |

---

## Full Working Example

```ts
// src/routes/dashboard/+page.server.ts
import { ChartQuery } from '@beeblock/svelar-charts';

export async function load() {
  const usersTrend = await ChartQuery.table('users')
    .count()
    .label('New Users')
    .trend('month', 365);

  const revenueByMonth = await ChartQuery.table('orders')
    .sum('total')
    .groupBy('month', 'created_at')
    .period('2026-01-01', '2026-12-31')
    .where('status', 'completed')
    .label('Revenue')
    .get();

  const usersByRole = await ChartQuery.table('users')
    .count()
    .groupBy('role')
    .label('Users by Role')
    .get();

  return { usersTrend, revenueByMonth, usersByRole };
}
```

```svelte
<!-- src/routes/dashboard/+page.svelte -->
<script lang="ts">
  import { StatCard, BarChart, PieChart } from '@beeblock/svelar-charts/ui';

  interface Props {
    data: {
      usersTrend: import('@beeblock/svelar-charts').TrendChartData;
      revenueByMonth: import('@beeblock/svelar-charts').ChartData;
      usersByRole: import('@beeblock/svelar-charts').ChartData;
    };
  }
  let { data }: Props = $props();
</script>

<div class="dashboard-grid">
  <StatCard
    title="New Users"
    value={String(data.usersTrend.currentValue)}
    change={data.usersTrend.change}
    trend={data.usersTrend.direction}
    sparkData={data.usersTrend.datasets[0]?.data}
    sparkColor="#3B82F6"
  />

  <BarChart data={data.revenueByMonth} height={350} showValues={true} />

  <PieChart data={data.usersByRole} size={300} showLabels={true} showPercentages={true} />
</div>
```

```ts
// src/routes/api/charts/revenue/+server.ts
import { ChartController } from '@beeblock/svelar-charts/server';
import { ChartQuery } from '@beeblock/svelar-charts';

export const GET = async (event) => {
  const query = ChartQuery.table('orders')
    .sum('total')
    .groupBy('month', 'created_at')
    .period('2026-01-01', '2026-12-31')
    .where('status', 'completed')
    .label('Revenue');

  return ChartController.serve(query);
};
```
