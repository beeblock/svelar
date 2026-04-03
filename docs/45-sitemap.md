# Sitemap Plugin

An XML sitemap generator plugin for Svelar/SvelteKit with a fluent builder API, model-based URL generation, sitemap index support, image sitemaps, scheduled regeneration, and both static file output and dynamic route serving.

**Package:** `@beeblock/svelar-sitemap`

**Install:**

```bash
npx svelar plugin:install @beeblock/svelar-sitemap
```

**Imports:**

```ts
// Plugin registration
import { SvelarSitemapPlugin } from '@beeblock/svelar-sitemap/server';

// Core API
import { Sitemap, SitemapGenerator, SitemapIndex, SitemapUrl } from '@beeblock/svelar-sitemap';

// Server-side (controller, scheduled task)
import { SitemapController, SitemapTask } from '@beeblock/svelar-sitemap/server';

// Types
import type { ChangeFreq, SitemapImage, SitemapUrlOptions, SitemapModelOptions, SitemapConfig, SitemapPluginConfig, SitemapIndexEntry } from '@beeblock/svelar-sitemap';
```

---

## Quick Start

### 1. Register the Plugin

```ts
// src/lib/plugins.ts
import { SvelarSitemapPlugin } from '@beeblock/svelar-sitemap/server';

export const sitemapPlugin = new SvelarSitemapPlugin({
  baseUrl: 'https://example.com',
  defaultChangeFreq: 'weekly',
  defaultPriority: 0.5,
  endpoint: '/sitemap.xml',
});
```

### 2. Serve the Sitemap Dynamically

```ts
// src/routes/sitemap.xml/+server.ts
import { SitemapController } from '@beeblock/svelar-sitemap/server';
import { Post } from '$lib/models/Post';

export const GET = SitemapController.handle(async (sitemap) => {
  sitemap.add('/', { changeFreq: 'daily', priority: 1.0 });
  sitemap.add('/about', { changeFreq: 'monthly', priority: 0.8 });
  sitemap.add('/contact', { changeFreq: 'monthly', priority: 0.5 });

  await sitemap.addModel(Post, {
    url: (post) => `/blog/${post.slug}`,
    lastmod: (post) => post.updated_at,
    changeFreq: 'weekly',
    priority: 0.7,
  });

  return sitemap;
});
```

---

## Configuration

The `SvelarSitemapPlugin` constructor accepts:

| Option | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | `'http://localhost'` | Base URL for all sitemap entries |
| `defaultChangeFreq` | `ChangeFreq` | `'weekly'` | Default change frequency for entries |
| `defaultPriority` | `number` | `0.5` | Default priority (0.0 to 1.0) |
| `outputPath` | `string` | `'static/sitemap.xml'` | File path for static sitemap generation |
| `maxUrlsPerSitemap` | `number` | `50000` | Max URLs per sitemap before splitting into index |
| `endpoint` | `string` | `'/sitemap.xml'` | Route path for serving the sitemap |

**ChangeFreq values:** `'always'`, `'hourly'`, `'daily'`, `'weekly'`, `'monthly'`, `'yearly'`, `'never'`

---

## Core API

### Sitemap Builder

The main class for constructing sitemaps. Create instances via `Sitemap.create()`:

```ts
import { Sitemap } from '@beeblock/svelar-sitemap';
```

**Static methods:**

| Method | Returns | Description |
|---|---|---|
| `Sitemap.configure(config)` | `void` | Set global configuration |
| `Sitemap.getConfig()` | `Readonly<SitemapConfig>` | Get current global configuration |
| `Sitemap.create(config?)` | `Sitemap` | Create a new builder instance |

**Instance methods:**

| Method | Returns | Description |
|---|---|---|
| `.add(path, options?)` | `Sitemap` | Add a single URL entry |
| `.addModel(model, options)` | `Promise<Sitemap>` | Add URLs from model records |
| `.toXml()` | `Promise<string>` | Generate the sitemap XML string |
| `.writeToFile(path?)` | `Promise<void>` | Write XML to a file |
| `.count` | `number` | Total number of URLs |
| `.getUrls()` | `readonly SitemapUrl[]` | Get all URL entries |
| `.needsIndex()` | `boolean` | Whether the sitemap exceeds maxUrlsPerSitemap |
| `.splitUrls()` | `SitemapUrl[][]` | Split URLs into chunks for index generation |

**Adding static URLs:**

```ts
const sitemap = Sitemap.create();

sitemap.add('/', {
  lastmod: '2026-04-01',
  changeFreq: 'daily',
  priority: 1.0,
});

sitemap.add('/about', {
  changeFreq: 'monthly',
  priority: 0.8,
  images: [
    { url: '/images/team.jpg', title: 'Our Team', caption: 'The team photo' },
  ],
});
```

**Adding model URLs:**

```ts
await sitemap.addModel(Post, {
  url: (post) => `/blog/${post.slug}`,
  lastmod: (post) => post.updated_at,
  changeFreq: 'weekly',
  priority: 0.7,
  images: (post) => post.featured_image
    ? [{ url: post.featured_image, title: post.title }]
    : [],
  query: (q) => q.where('published', true),
});
```

**SitemapUrlOptions:**

| Option | Type | Description |
|---|---|---|
| `lastmod` | `string \| Date` | Last modification date (formatted as YYYY-MM-DD) |
| `changeFreq` | `ChangeFreq` | How frequently the page changes |
| `priority` | `number` | Priority from 0.0 to 1.0 (clamped automatically) |
| `images` | `SitemapImage[]` | Image entries per the image sitemap extension |

**SitemapModelOptions:**

| Option | Type | Description |
|---|---|---|
| `url` | `(record) => string` | Required. Returns the URL path for each record |
| `lastmod` | `(record) => string \| Date \| undefined` | Optional. Returns the last modification date |
| `changeFreq` | `ChangeFreq` | Default change frequency for model URLs |
| `priority` | `number` | Default priority for model URLs |
| `images` | `(record) => SitemapImage[]` | Optional. Returns images for each record |
| `query` | `(q) => any` | Optional. Filters the model query |

### SitemapUrl

Represents a single URL entry in the sitemap:

```ts
const url = new SitemapUrl('/blog/my-post', {
  lastmod: '2026-04-01',
  changeFreq: 'weekly',
  priority: 0.7,
  images: [{ url: '/images/post.jpg', title: 'Post Image' }],
});

url.loc;        // '/blog/my-post'
url.lastmod;    // '2026-04-01'
url.changeFreq; // 'weekly'
url.priority;   // 0.7
url.images;     // SitemapImage[]

const xml = url.toXml('https://example.com');
```

### SitemapGenerator

Low-level XML generator. Used internally by `Sitemap.toXml()`:

```ts
import { SitemapGenerator } from '@beeblock/svelar-sitemap';

const xml = SitemapGenerator.generate(urls, 'https://example.com');
```

Automatically includes the image namespace if any URL has images.

### SitemapIndex

Builds a sitemap index XML document for large sites that split across multiple sitemaps:

```ts
import { SitemapIndex } from '@beeblock/svelar-sitemap';

const index = SitemapIndex.create('https://example.com');

index.addSitemap('/sitemap-posts.xml', '2026-04-01');
index.addSitemap('/sitemap-products.xml', new Date());
index.addSitemap('/sitemap-pages.xml');

const xml = index.toXml();
```

| Method | Returns | Description |
|---|---|---|
| `SitemapIndex.create(baseUrl?)` | `SitemapIndex` | Create a new index builder |
| `.addSitemap(loc, lastmod?)` | `SitemapIndex` | Add a sub-sitemap reference |
| `.toXml()` | `string` | Generate the sitemap index XML |

---

## Server-Side

### SitemapController

Handles dynamic sitemap serving from SvelteKit routes:

```ts
// src/routes/sitemap.xml/+server.ts
import { SitemapController } from '@beeblock/svelar-sitemap/server';

export const GET = SitemapController.handle(async (sitemap) => {
  sitemap.add('/', { changeFreq: 'daily', priority: 1.0 });
  sitemap.add('/about');
  // ... add more URLs
  return sitemap;
});
```

```ts
// src/routes/sitemap-index.xml/+server.ts
import { SitemapController } from '@beeblock/svelar-sitemap/server';
import { SitemapIndex } from '@beeblock/svelar-sitemap';

export const GET = SitemapController.handleIndex(async () => {
  const index = SitemapIndex.create('https://example.com');
  index.addSitemap('/sitemap-pages.xml', new Date());
  index.addSitemap('/sitemap-posts.xml', new Date());
  return index.toXml();
});
```

**Response headers set by the controller:**
- `Content-Type: application/xml; charset=utf-8`
- `Cache-Control: public, max-age=3600, s-maxage=3600`
- `X-Robots-Tag: noindex`

### SitemapTask

An abstract `ScheduledTask`-compatible class for scheduled sitemap regeneration. Extend it and implement `buildSitemap()`:

```ts
// src/lib/scheduler/GenerateSitemap.ts
import { SitemapTask } from '@beeblock/svelar-sitemap/server';
import { Post } from '$lib/models/Post';

export default class GenerateSitemap extends SitemapTask {
  schedule() {
    return this.daily();
  }

  async buildSitemap(sitemap) {
    sitemap.add('/', { changeFreq: 'daily', priority: 1.0 });
    sitemap.add('/about', { changeFreq: 'monthly', priority: 0.8 });

    await sitemap.addModel(Post, {
      url: (p) => `/blog/${p.slug}`,
      lastmod: (p) => p.updated_at,
      changeFreq: 'weekly',
      priority: 0.7,
      query: (q) => q.where('published', true),
    });

    return sitemap;
  }
}
```

**Scheduling methods (mirror ScheduledTask API):**

| Method | Description |
|---|---|
| `.everyMinute()` | Run every minute |
| `.everyFiveMinutes()` | Run every 5 minutes |
| `.everyFifteenMinutes()` | Run every 15 minutes |
| `.everyThirtyMinutes()` | Run every 30 minutes |
| `.hourly()` | Run every hour |
| `.daily()` | Run daily at midnight |
| `.dailyAt(time)` | Run daily at a specific time (e.g. `'03:00'`) |
| `.weekly()` | Run weekly (Sunday at midnight) |
| `.monthly()` | Run monthly (1st at midnight) |
| `.cron(expression)` | Set a custom cron expression |
| `.outputPath(path)` | Set a custom output file path |

The default schedule is `0 3 * * *` (daily at 3 AM). The `handle()` method builds the sitemap and writes it to the configured output path.

---

## Full Working Example

```ts
// src/lib/plugins.ts
import { SvelarSitemapPlugin } from '@beeblock/svelar-sitemap/server';

export const sitemapPlugin = new SvelarSitemapPlugin({
  baseUrl: 'https://myapp.com',
  defaultChangeFreq: 'weekly',
  defaultPriority: 0.5,
  outputPath: 'static/sitemap.xml',
  maxUrlsPerSitemap: 50000,
});
```

```ts
// src/routes/sitemap.xml/+server.ts
import { SitemapController } from '@beeblock/svelar-sitemap/server';
import { Post } from '$lib/models/Post';
import { Product } from '$lib/models/Product';

export const GET = SitemapController.handle(async (sitemap) => {
  // Static pages
  sitemap
    .add('/', { changeFreq: 'daily', priority: 1.0 })
    .add('/about', { changeFreq: 'monthly', priority: 0.8 })
    .add('/contact', { changeFreq: 'monthly', priority: 0.5 })
    .add('/pricing', { changeFreq: 'weekly', priority: 0.9 });

  // Blog posts
  await sitemap.addModel(Post, {
    url: (post) => `/blog/${post.slug}`,
    lastmod: (post) => post.updated_at,
    changeFreq: 'weekly',
    priority: 0.7,
    images: (post) => post.featured_image
      ? [{ url: post.featured_image, title: post.title }]
      : [],
    query: (q) => q.where('published', true),
  });

  // Products
  await sitemap.addModel(Product, {
    url: (product) => `/products/${product.slug}`,
    lastmod: (product) => product.updated_at,
    changeFreq: 'daily',
    priority: 0.8,
  });

  return sitemap;
});
```

```ts
// For large sites with multiple sitemaps
// src/routes/sitemap-index.xml/+server.ts
import { SitemapController } from '@beeblock/svelar-sitemap/server';
import { SitemapIndex } from '@beeblock/svelar-sitemap';

export const GET = SitemapController.handleIndex(async () => {
  const index = SitemapIndex.create('https://myapp.com');
  index.addSitemap('/sitemap-pages.xml', new Date());
  index.addSitemap('/sitemap-posts.xml', new Date());
  index.addSitemap('/sitemap-products.xml', new Date());
  return index.toXml();
});
```

```ts
// Static generation via scheduled task
// src/lib/scheduler/GenerateSitemap.ts
import { SitemapTask } from '@beeblock/svelar-sitemap/server';
import { Post } from '$lib/models/Post';

export default class GenerateSitemap extends SitemapTask {
  schedule() {
    return this.dailyAt('03:00');
  }

  async buildSitemap(sitemap) {
    sitemap.add('/', { changeFreq: 'daily', priority: 1.0 });
    sitemap.add('/about', { priority: 0.8 });

    await sitemap.addModel(Post, {
      url: (p) => `/blog/${p.slug}`,
      lastmod: (p) => p.updated_at,
      query: (q) => q.where('published', true),
    });

    return sitemap;
  }
}
```

```ts
// Programmatic static generation (e.g., in a build script)
import { Sitemap } from '@beeblock/svelar-sitemap';

Sitemap.configure({
  baseUrl: 'https://myapp.com',
  outputPath: 'static/sitemap.xml',
});

const sitemap = Sitemap.create();
sitemap.add('/', { priority: 1.0 });
sitemap.add('/about');

await sitemap.writeToFile();
// Writes to static/sitemap.xml
```
