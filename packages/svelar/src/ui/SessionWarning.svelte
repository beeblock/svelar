<script lang="ts">
  import { onMount } from 'svelte';
  import type { SessionActivityStatus } from '@beeblock/svelar/session';
  import { SessionActivityClient, sessionCsrfToken, type SessionActivityClientState } from './session-activity.js';

  interface Props {
    statusUrl: string;
    renewUrl: string;
    initial?: SessionActivityStatus;
    signInUrl?: string;
    channelName?: string;
    csrfCookieName?: string;
    csrfHeaderName?: string;
    title?: string;
    expiredTitle?: string;
    renewLabel?: string;
    signInLabel?: string;
    dismissLabel?: string;
  }

  let { statusUrl, renewUrl, initial, signInUrl = '/login', channelName = 'svelar:session-activity',
    csrfCookieName = 'XSRF-TOKEN', csrfHeaderName = 'X-CSRF-Token', title = 'Your session is about to expire',
    expiredTitle = 'Your session has expired', renewLabel = 'Stay signed in', signInLabel = 'Sign in again', dismissLabel = 'Dismiss' }: Props = $props();
  const titleId = $props.id();
  let dialog = $state<HTMLDialogElement>();
  let client = $state<SessionActivityClient>();
  // svelte-ignore state_referenced_locally
  let state = $state<SessionActivityClientState>({ status: initial ?? null, expired: initial?.expired ?? false, renewing: false, error: null });
  let now = $state(Date.now());
  let dismissedFor = $state<string | null>(null);
  const remaining = $derived.by(() => { now; return client?.remainingSeconds() ?? state.status?.remainingSeconds ?? null; });
  const expired = $derived(state.expired || (remaining !== null && remaining <= 0));
  const warning = $derived(state.status !== null && remaining !== null && state.status.serverTime + (state.status.remainingSeconds - remaining) * 1000 >= state.status.warningAt);
  const noticeKey = $derived(`${state.status?.expiresAt ?? 'none'}:${expired}`);

  function dismiss() { dismissedFor = noticeKey; dialog?.close(); }

  $effect(() => {
    const visible = (expired || warning) && dismissedFor !== noticeKey;
    if (dialog && visible && !dialog.open) dialog.showModal();
    else if (dialog?.open && !visible) dialog.close();
  });

  $effect(() => { initial?.serverTime; if (client) void client.refresh(); });

  onMount(() => {
    let channel: BroadcastChannel | null = null;
    try { if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(channelName); } catch { /* Storage events remain available. */ }
    const bus = {
      subscribe(refresh: () => void) {
        const message = () => refresh();
        const storage = (event: StorageEvent) => { if (event.key === channelName) refresh(); };
        channel?.addEventListener('message', message);
        window.addEventListener('storage', storage);
        return () => { channel?.removeEventListener('message', message); window.removeEventListener('storage', storage); };
      },
      publish() {
        if (channel) channel.postMessage({ type: 'session-changed' });
        else { try { localStorage.setItem(channelName, `${Date.now()}:${Math.random()}`); } catch { /* Visibility refresh still checks the server. */ } }
      },
    };
    client = new SessionActivityClient({ baseUrl: window.location.href, statusUrl, renewUrl, initial, bus,
      csrfToken: () => sessionCsrfToken(document.cookie, csrfCookieName), csrfHeader: csrfHeaderName });
    const unsubscribe = client.subscribe((value) => { state = value; });
    void client.refresh();
    const visibility = () => { if (document.visibilityState === 'visible') void client?.refresh(); };
    document.addEventListener('visibilitychange', visibility);
    let checked = '';
    const timer = setInterval(() => {
      now = Date.now();
      const boundary = `${state.status?.expiresAt}:${client?.remainingSeconds() === 0 ? 'expired' : warning ? 'warning' : 'active'}`;
      if (boundary !== checked && (warning || expired)) { checked = boundary; void client?.refresh(); }
    }, 1000);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visibility); unsubscribe(); client?.dispose(); channel?.close(); };
  });
</script>

<dialog bind:this={dialog} aria-labelledby={titleId} aria-describedby={`${titleId}-description`} oncancel={(event) => { event.preventDefault(); dismiss(); }}>
  <h2 id={titleId}>{expired ? expiredTitle : title}</h2>
  <p id={`${titleId}-description`}>{expired ? 'Sign in to continue.' : 'Your changes may be lost when the session ends.'}</p>
  {#if !expired && remaining !== null}<p aria-live="off">Time remaining: {remaining} seconds</p>{/if}
  {#if state.error}<p role="alert">{state.error}</p>{/if}
  <div class="actions">
    {#if expired}
      <a href={signInUrl}>{signInLabel}</a>
    {:else}
      <button type="button" disabled={state.renewing} aria-busy={state.renewing} onclick={() => client?.renew()}>{state.renewing ? 'Renewing...' : renewLabel}</button>
      <button type="button" class="secondary" disabled={state.renewing} onclick={dismiss}>{dismissLabel}</button>
    {/if}
  </div>
</dialog>

{#if state.error && !state.status && !expired}
  <div class="notice" role="status">
    <span>{state.error}</span>
    <button type="button" class="secondary" onclick={() => client?.refresh()}>Retry</button>
  </div>
{/if}

<style>
  dialog { width: min(26rem, calc(100vw - 2rem)); box-sizing: border-box; margin: auto; padding: 1.5rem; border: 1px solid #d4d4d8; border-radius: 8px; background: #fff; color: #18181b; overflow-wrap: anywhere; }
  dialog::backdrop { background: rgb(0 0 0 / 40%); }
  h2 { margin: 0 0 0.75rem; font-size: 1.125rem; line-height: 1.5; }
  p { font-size: 0.875rem; line-height: 1.5; }
  .actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1.25rem; }
  .notice { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; font-size: 0.875rem; }
  button, a { padding: 0.625rem 0.875rem; border: 1px solid #166534; border-radius: 4px; background: #166534; color: #fff; font: inherit; text-decoration: none; white-space: normal; cursor: pointer; }
  .secondary { background: #fff; border-color: #d4d4d8; color: #18181b; }
  button:disabled { opacity: 0.6; cursor: wait; }
  button:focus-visible, a:focus-visible { outline: 2px solid #2563eb; outline-offset: 3px; }
</style>
