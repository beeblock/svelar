import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compile } from 'svelte/compiler';
import { dismiss, dismissAll, getToasts, pauseToast, resumeToast, subscribe, toast } from '../src/ui/toast';

const uiDir = join(process.cwd(), 'src/ui');

describe('UI components', () => {
  afterEach(() => {
    dismissAll();
    vi.useRealTimers();
  });

  it('compiles every bundled Svelte UI component for server rendering', async () => {
    const files = (await readdir(uiDir)).filter((file) => file.endsWith('.svelte'));

    expect(files).toContain('Seo.svelte');
    expect(files).toContain('Toaster.svelte');

    for (const file of files) {
      const source = await readFile(join(uiDir, file), 'utf8');
      expect(() => compile(source, { filename: file, generate: 'server' })).not.toThrow();
    }
  });

  it('keeps the Seo component aligned with the documented metadata surface', async () => {
    const source = await readFile(join(uiDir, 'Seo.svelte'), 'utf8');
    const requiredSnippets = [
      '<title>{title}</title>',
      'name="description"',
      'rel="canonical"',
      'name="robots"',
      'property="og:title"',
      'property="og:image"',
      'name="twitter:card"',
      'name="twitter:image"',
      'application/ld+json',
      'noindex',
      'nofollow',
    ];

    for (const snippet of requiredSnippets) {
      expect(source).toContain(snippet);
    }
  });
});

describe('toast store', () => {
  afterEach(() => {
    dismissAll();
    vi.useRealTimers();
  });

  it('adds variant toasts, notifies subscribers, and dismisses them', () => {
    vi.useFakeTimers();
    let notifications = 0;
    const unsubscribe = subscribe(() => {
      notifications += 1;
    });

    const id = toast.success('Saved', {
      description: 'The post was saved.',
      duration: 5000,
    });

    expect(getToasts()).toEqual([
      expect.objectContaining({
        id,
        variant: 'success',
        title: 'Saved',
        description: 'The post was saved.',
        state: 'entering',
        remaining: 5000,
      }),
    ]);

    vi.advanceTimersByTime(300);
    expect(getToasts()[0].state).toBe('visible');

    dismiss(id);
    expect(getToasts()[0].state).toBe('exiting');
    vi.advanceTimersByTime(200);
    expect(getToasts()).toHaveLength(0);

    unsubscribe();
    expect(notifications).toBeGreaterThanOrEqual(3);
  });

  it('supports persistent, paused, resumed, and promise-driven toasts', async () => {
    vi.useFakeTimers();

    const persistentId = toast.error('Needs attention', { duration: 0 });
    expect(getToasts()[0]).toMatchObject({
      id: persistentId,
      variant: 'error',
      duration: 0,
      remaining: 0,
    });

    const timedId = toast.info('Uploading', { duration: 5000 });
    vi.advanceTimersByTime(300);
    pauseToast(timedId);
    const paused = getToasts().find((item) => item.id === timedId);
    expect(paused?.pausedAt).toBeTruthy();
    expect(paused?.remaining).toBeGreaterThan(0);

    resumeToast(timedId);
    expect(getToasts().find((item) => item.id === timedId)?.pausedAt).toBeUndefined();

    const promise = Promise.resolve('done');
    const tracked = toast.promise(promise, {
      loading: 'Working',
      success: (value) => `Finished ${value}`,
      error: 'Failed',
    });

    await expect(tracked).resolves.toBe('done');
    await Promise.resolve();

    expect(getToasts()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ variant: 'success', title: 'Finished done' }),
      ]),
    );

    dismissAll();
    vi.advanceTimersByTime(200);
    expect(getToasts()).toHaveLength(0);
  });
});
