<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    // Basic
    title?: string;
    description?: string;
    keywords?: string;
    canonical?: string;

    // Open Graph
    ogTitle?: string;
    ogDescription?: string;
    ogImage?: string;
    ogUrl?: string;
    ogType?: string;
    ogSiteName?: string;
    ogLocale?: string;

    // Twitter Card
    twitterCard?: 'summary' | 'summary_large_image' | 'app' | 'player';
    twitterSite?: string;
    twitterCreator?: string;
    twitterTitle?: string;
    twitterDescription?: string;
    twitterImage?: string;

    // Robots
    robots?: string;
    noindex?: boolean;
    nofollow?: boolean;

    // JSON-LD structured data (pass a plain object, rendered as <script type="application/ld+json">)
    jsonLd?: Record<string, any>;

    // Extra <svelte:head> content
    children?: Snippet;
  }

  let {
    title,
    description,
    keywords,
    canonical,
    ogTitle,
    ogDescription,
    ogImage,
    ogUrl,
    ogType = 'website',
    ogSiteName,
    ogLocale,
    twitterCard = 'summary_large_image',
    twitterSite,
    twitterCreator,
    twitterTitle,
    twitterDescription,
    twitterImage,
    robots,
    noindex = false,
    nofollow = false,
    jsonLd,
    children,
  }: Props = $props();

  // Build robots directive
  let robotsContent = $derived(
    robots ?? [noindex ? 'noindex' : '', nofollow ? 'nofollow' : ''].filter(Boolean).join(', ')
  );

  // Serialize JSON-LD
  let jsonLdScript = $derived(jsonLd ? JSON.stringify(jsonLd) : '');
</script>

<svelte:head>
  {#if title}<title>{title}</title>{/if}
  {#if description}<meta name="description" content={description} />{/if}
  {#if keywords}<meta name="keywords" content={keywords} />{/if}
  {#if canonical}<link rel="canonical" href={canonical} />{/if}
  {#if robotsContent}<meta name="robots" content={robotsContent} />{/if}

  <!-- Open Graph -->
  {#if ogTitle || title}<meta property="og:title" content={ogTitle ?? title} />{/if}
  {#if ogDescription || description}<meta property="og:description" content={ogDescription ?? description} />{/if}
  {#if ogImage}<meta property="og:image" content={ogImage} />{/if}
  {#if ogUrl || canonical}<meta property="og:url" content={ogUrl ?? canonical} />{/if}
  {#if ogType}<meta property="og:type" content={ogType} />{/if}
  {#if ogSiteName}<meta property="og:site_name" content={ogSiteName} />{/if}
  {#if ogLocale}<meta property="og:locale" content={ogLocale} />{/if}

  <!-- Twitter Card -->
  {#if twitterCard}<meta name="twitter:card" content={twitterCard} />{/if}
  {#if twitterSite}<meta name="twitter:site" content={twitterSite} />{/if}
  {#if twitterCreator}<meta name="twitter:creator" content={twitterCreator} />{/if}
  {#if twitterTitle || ogTitle || title}<meta name="twitter:title" content={twitterTitle ?? ogTitle ?? title} />{/if}
  {#if twitterDescription || ogDescription || description}<meta name="twitter:description" content={twitterDescription ?? ogDescription ?? description} />{/if}
  {#if twitterImage || ogImage}<meta name="twitter:image" content={twitterImage ?? ogImage} />{/if}

  <!-- JSON-LD Structured Data -->
  {#if jsonLdScript}
    {@html `<script type="application/ld+json">${jsonLdScript}</script>`}
  {/if}

  {#if children}{@render children()}{/if}
</svelte:head>
