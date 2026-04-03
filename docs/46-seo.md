# SEO

Svelar ships a `<Seo>` component that handles meta tags, Open Graph, Twitter Cards, canonical URLs, robots directives, and JSON-LD structured data — all from a single component.

SvelteKit renders pages server-side by default, so crawlers see your full HTML content without needing JavaScript. The `<Seo>` component builds on this by injecting the right `<head>` tags.

## Quick Start

The scaffold already includes `<Seo>` in the root layout with site-wide defaults:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { Seo } from '@beeblock/svelar/ui';
</script>

<Seo
  title="My App"
  description="My App — built with Svelar, the Laravel of SvelteKit."
  ogSiteName="My App"
  ogType="website"
/>
```

Override per page by adding another `<Seo>` — SvelteKit merges `<svelte:head>` blocks, with page-level tags taking priority:

```svelte
<!-- src/routes/about/+page.svelte -->
<script lang="ts">
  import { Seo } from '@beeblock/svelar/ui';
</script>

<Seo
  title="About Us — My App"
  description="Learn about our team and mission."
  ogImage="/images/about-og.png"
  canonical="https://myapp.com/about"
/>
```

## Props Reference

### Basic

| Prop | Type | Description |
|------|------|-------------|
| `title` | `string` | Page `<title>` — also used as fallback for OG/Twitter titles |
| `description` | `string` | `<meta name="description">` — also fallback for OG/Twitter descriptions |
| `keywords` | `string` | `<meta name="keywords">` (comma-separated) |
| `canonical` | `string` | `<link rel="canonical">` — also fallback for `og:url` |

### Open Graph

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `ogTitle` | `string` | Falls back to `title` | `og:title` |
| `ogDescription` | `string` | Falls back to `description` | `og:description` |
| `ogImage` | `string` | — | `og:image` (use absolute URL for best compatibility) |
| `ogUrl` | `string` | Falls back to `canonical` | `og:url` |
| `ogType` | `string` | `'website'` | `og:type` — use `'article'` for blog posts |
| `ogSiteName` | `string` | — | `og:site_name` |
| `ogLocale` | `string` | — | `og:locale` (e.g., `'en_US'`) |

### Twitter Card

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `twitterCard` | `string` | `'summary_large_image'` | Card type: `'summary'`, `'summary_large_image'`, `'app'`, `'player'` |
| `twitterSite` | `string` | — | Your site's Twitter handle (e.g., `'@myapp'`) |
| `twitterCreator` | `string` | — | Content author's Twitter handle |
| `twitterTitle` | `string` | Falls back to `ogTitle` then `title` | Title shown in Twitter card |
| `twitterDescription` | `string` | Falls back to `ogDescription` then `description` | Description in Twitter card |
| `twitterImage` | `string` | Falls back to `ogImage` | Image in Twitter card |

### Robots

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `robots` | `string` | — | Full robots directive (overrides `noindex`/`nofollow`) |
| `noindex` | `boolean` | `false` | Add `noindex` to robots |
| `nofollow` | `boolean` | `false` | Add `nofollow` to robots |

### Structured Data

| Prop | Type | Description |
|------|------|-------------|
| `jsonLd` | `Record<string, any>` | JSON-LD object — rendered as `<script type="application/ld+json">` |

### Extra Head Content

The `<Seo>` component also accepts children for injecting additional `<svelte:head>` content:

```svelte
<Seo title="My Page" description="...">
  <link rel="alternate" hreflang="es" href="https://myapp.com/es/page" />
  <meta property="article:published_time" content="2026-01-15" />
</Seo>
```

## Patterns

### Blog Post with Article Metadata

```svelte
<script lang="ts">
  import { Seo } from '@beeblock/svelar/ui';
  let { data } = $props();
  const { post } = data;
</script>

<Seo
  title="{post.title} — My Blog"
  description={post.excerpt}
  ogType="article"
  ogImage={post.coverImage}
  canonical="https://myapp.com/blog/{post.slug}"
  jsonLd={{
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.excerpt,
    image: post.coverImage,
    datePublished: post.createdAt,
    dateModified: post.updatedAt,
    author: {
      '@type': 'Person',
      name: post.author.name,
    },
  }}
/>
```

### Product Page with JSON-LD

```svelte
<Seo
  title="{product.name} — My Store"
  description={product.shortDescription}
  ogImage={product.images[0]}
  canonical="https://mystore.com/products/{product.slug}"
  jsonLd={{
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.shortDescription,
    image: product.images,
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: 'USD',
      availability: product.inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
    },
  }}
/>
```

### SaaS Landing Page with Organization

```svelte
<Seo
  title="My SaaS — Ship faster with Svelar"
  description="The fastest way to build modern SaaS applications."
  ogImage="https://myapp.com/og-home.png"
  canonical="https://myapp.com"
  twitterSite="@myapp"
  jsonLd={{
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'My SaaS',
    url: 'https://myapp.com',
    logo: 'https://myapp.com/logo.png',
    sameAs: [
      'https://twitter.com/myapp',
      'https://github.com/myapp',
    ],
  }}
/>
```

### Dynamic Title from Load Data

```svelte
<!-- +page.server.ts -->
<script lang="ts" context="module">
  export async function load({ params }) {
    const user = await User.findOrFail(params.id);
    return { user };
  }
</script>

<!-- +page.svelte -->
<script lang="ts">
  import { Seo } from '@beeblock/svelar/ui';
  let { data } = $props();
</script>

<Seo
  title="{data.user.name}'s Profile"
  description="{data.user.name} on My App."
  noindex
/>
```

### Preventing Indexing

For admin pages, dashboard, or draft content:

```svelte
<Seo title="Admin Panel" noindex nofollow />
```

Or with a custom robots string:

```svelte
<Seo title="Archive" robots="noindex, follow" />
```

## Sitemap

For automatic XML sitemap generation, use the `@beeblock/svelar-sitemap` plugin:

```bash
npx svelar plugin:install @beeblock/svelar-sitemap
```

See the [Sitemap Plugin](./45-sitemap.md) docs for configuration.

## robots.txt

Add a `static/robots.txt` file to your project:

```
User-agent: *
Allow: /

Sitemap: https://myapp.com/sitemap.xml
```

For dynamic robots.txt, create a SvelteKit endpoint:

```typescript
// src/routes/robots.txt/+server.ts
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
  const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /dashboard
Disallow: /api/

Sitemap: https://myapp.com/sitemap.xml`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain' },
  });
};
```

## Best Practices

1. **Always set `title` and `description`** on every page — these are the most important tags for search engines
2. **Use absolute URLs** for `ogImage`, `canonical`, and `ogUrl` — relative URLs don't work reliably with social media crawlers
3. **Keep titles under 60 characters** and descriptions under 160 characters
4. **Set `canonical` on pages with query parameters** to avoid duplicate content (e.g., paginated lists)
5. **Use `noindex` on private pages** — dashboard, admin, settings, etc.
6. **Add JSON-LD structured data** for content pages — articles, products, events, FAQs — to get rich snippets in search results
7. **Set `ogImage` dimensions** to 1200x630px for optimal display on social platforms
8. **Use `og:type="article"` for blog posts** and `og:type="website"` for everything else
9. **Set `ogSiteName` once in the root layout** — it applies globally
10. **Test your meta tags** with [Google Rich Results Test](https://search.google.com/test/rich-results) and social media debuggers (Twitter Card Validator, Facebook Sharing Debugger)
