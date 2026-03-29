import { error } from '@sveltejs/kit';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import type { PageServerLoad } from './$types.js';

// Resolve docs directory — try both strategies for dev and build
const __dir = dirname(fileURLToPath(import.meta.url));
const docsDirFromFile = resolve(__dir, '../../../../../../docs');
const docsDirFromCwd = resolve(process.cwd(), '../../docs');

const docsDir = existsSync(docsDirFromFile) ? docsDirFromFile
  : existsSync(docsDirFromCwd) ? docsDirFromCwd
  : docsDirFromFile;

interface DocEntry {
  slug: string;
  title: string;
  filename: string;
  order: number;
}

function getDocsList(): DocEntry[] {
  try {
    const files = readdirSync(docsDir).filter(
      (f) => f.endsWith('.md') && f !== 'README.md'
    );

    return files
      .map((filename) => {
        const match = filename.match(/^(\d+)-(.+)\.md$/);
        if (!match) return null;

        const order = parseInt(match[1], 10);
        const slug = match[2];

        // Read the first H1 from the file as the title
        let title = slug
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');

        try {
          const content = readFileSync(join(docsDir, filename), 'utf-8');
          const h1Match = content.match(/^#\s+(.+)$/m);
          if (h1Match) title = h1Match[1];
        } catch {
          // Fall back to slug-derived title
        }

        return { slug, title, filename, order };
      })
      .filter(Boolean)
      .sort((a, b) => a!.order - b!.order) as DocEntry[];
  } catch {
    return [];
  }
}

// Rewrite markdown links: ./XX-slug.md -> /docs/slug and ./XX-slug.md#hash -> /docs/slug#hash
function rewriteDocLinks(markdown: string): string {
  // Single regex handles both with and without hash fragment
  // Pattern: ](./NN-slug-name.md) or ](./NN-slug-name.md#section)
  return markdown.replace(
    /\]\(\.\/\d+-([^)#]+)\.md(#[^)]*)?\)/g,
    (_match, slug, hash) => `](/docs/${slug}${hash || ''})`
  );
}

function readDocFile(slug: string): { content: string; title: string } | null {
  const docs = getDocsList();
  const doc = docs.find((d) => d.slug === slug);
  if (!doc) return null;

  try {
    const raw = readFileSync(join(docsDir, doc.filename), 'utf-8');

    // Extract the first H1 as the title
    const titleMatch = raw.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : doc.title;

    // Rewrite internal doc links then convert to HTML
    const rewritten = rewriteDocLinks(raw);
    const html = marked.parse(rewritten, { async: false }) as string;

    return { content: html, title };
  } catch {
    return null;
  }
}

// Normalize slug: "00-getting-started.md" -> "getting-started", "getting-started" -> "getting-started"
function normalizeSlug(raw: string): string {
  return raw
    .replace(/\.md$/, '')        // strip .md extension
    .replace(/^\d+-/, '');       // strip number prefix like "00-"
}

export const load: PageServerLoad = async ({ params, url }) => {
  const slug = normalizeSlug(params.slug);

  // Redirect if the URL had a non-canonical slug (e.g. "00-getting-started.md")
  if (slug !== params.slug) {
    const { redirect } = await import('@sveltejs/kit');
    throw redirect(301, `/docs/${slug}`);
  }

  const result = readDocFile(slug);
  if (!result) {
    throw error(404, `Documentation page "${slug}" not found`);
  }

  const docs = getDocsList();
  const currentIndex = docs.findIndex((d) => d.slug === slug);

  return {
    title: result.title,
    content: result.content,
    slug,
    docs,
    prev: currentIndex > 0 ? docs[currentIndex - 1] : null,
    next: currentIndex < docs.length - 1 ? docs[currentIndex + 1] : null,
  };
};
