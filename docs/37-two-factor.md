# Two-Factor Authentication Plugin

TOTP-based two-factor authentication plugin for Svelar/SvelteKit with QR code generation, recovery codes, and pre-built UI components for setup, verification, and recovery. Zero external dependencies for QR code and TOTP generation.

**Package:** `@beeblock/svelar-two-factor`

**Install:**

```bash
npx svelar plugin:install @beeblock/svelar-two-factor
```

**Imports:**

```ts
// Dedicated server-only plugin registration
import SvelarTwoFactorPlugin from '@beeblock/svelar-two-factor/plugin';

// Core API
import { TwoFactor, TwoFactorService, TOTP, QRCode, RecoveryCodes, HasTwoFactor } from '@beeblock/svelar-two-factor/server';

// Server-side (controller, middleware)
import { TwoFactorController, TwoFactorMiddleware } from '@beeblock/svelar-two-factor/server';

// UI components
import { TwoFactorSetup, TwoFactorChallenge, RecoveryCodes as RecoveryCodesUI } from '@beeblock/svelar-two-factor/ui';

// Types
import type { TwoFactorConfig, TwoFactorUser, TwoFactorSecret, TOTPOptions } from '@beeblock/svelar-two-factor';
```

---

## Quick Start

### 1. Register the Plugin

```ts
// src/lib/plugins.ts
import { SvelarTwoFactorPlugin } from '@beeblock/svelar-two-factor/server';

export const twoFactorPlugin = new SvelarTwoFactorPlugin({
  issuer: 'MyApp',
  digits: 6,
  period: 30,
  algorithm: 'SHA1',
  recoveryCodes: 8,
  window: 1,
});
```

### 2. Add to Your User Model

```ts
import { Model } from '@beeblock/svelar/orm';
import { HasTwoFactor } from '@beeblock/svelar-two-factor/server';

class User extends HasTwoFactor(Model) {
  static table = 'users';

  hasTwoFactorEnabled(): boolean {
    return Boolean(this.getAttribute('two_factor_secret') && this.getAttribute('two_factor_confirmed_at'));
  }
}
```

### 3. Set Up API Routes

Publish the thin route stub, then bind the application's authentication/session middleware:

```bash
npx svelar plugin:publish @beeblock/svelar-two-factor
```

The published `src/routes/api/two-factor/+server.ts` dispatches POST requests by `?action=enable`, `confirm`, `verify`, or `recovery-codes`, and dispatches DELETE to `disable`. The verification URL must match the middleware's `apiPrefix` and `?action=verify` exactly.

The controller extends Svelar `Controller` and uses shared schemas → `FormRequest` → `TwoFactorDTO` → `TwoFactorAction` → service → persisted user → resource. Its reviewed self-service capability exemption grants access only to the current authenticated account. Keep authentication and a real Svelar session enabled; generic endpoints reject bearer credentials and require CSRF. Protect host settings/challenge pages with their application authorization. Invalid payloads fail validation, and attempts use a cache rate limit of five per minute per account. Configure a shared cache store for multiple processes; an in-memory store limits only its own process.

---

## Configuration

The `SvelarTwoFactorPlugin` constructor accepts:

| Option | Type | Default | Description |
|---|---|---|---|
| `issuer` | `string` | `'Svelar'` | Issuer name shown in authenticator apps |
| `digits` | `number` | `6` | TOTP length, 6–8 digits; pass the same value to the UI |
| `period` | `number` | `30` | TOTP period, 1–300 seconds |
| `algorithm` | `string` | `'SHA1'` | HMAC algorithm (`SHA1`, `SHA256`, `SHA512`) |
| `recoveryCodes` | `number` | `8` | Number of recovery codes to generate, 1–100 |
| `window` | `number` | `1` | Time-step window, 0–10 steps on either side |
| `prefix` | `string` | `'/api/two-factor'` | Configuration metadata; published route destination remains `/api/two-factor` |

---

## Core API

### TwoFactor Facade

```ts
import { TwoFactor } from '@beeblock/svelar-two-factor/server';

// Plugin boot configures this shared server facade.
TwoFactor.configure({ issuer: 'MyApp', digits: 6, period: 30 });

// user is the authenticated, persisted host model.
const setup = await TwoFactor.generateSecret(user);
// { secret, qrCodeSvg, qrCodeUrl } — qrCodeUrl is the otpauth:// URI.
const confirmed = await TwoFactor.confirmSetup(user, submittedCode);
if (confirmed) {
  const recoveryCodes = await TwoFactor.getRecoveryCodes(user);
  // Deliver these newly generated plaintext codes once through an authorized response.
}

const valid = TwoFactor.verify(user, submittedCode); // synchronous boolean
const recovered = await TwoFactor.verifyRecoveryCode(user, submittedRecoveryCode);
const replacementCodes = await TwoFactor.regenerateRecoveryCodes(user);
await TwoFactor.disable(user);
```

Setup cannot restart or reconfirm an enabled account. Recovery codes work only after confirmation. `getRecoveryCodes` generates a new set; it does not retrieve previously stored plaintext. Codes are hashed before storage and atomically consumed once. ORM users use a primary-key/secret/hash-scoped compare-and-swap; a custom persistence adapter must implement `consumeRecoveryCode(expected, replacement)` atomically.

Direct service calls run inside trusted application actions and do not perform HTTP authorization themselves. The controller additionally requires current TOTP proof for regeneration and disabling, and verified two-factor session state for management of an enabled account.

### TwoFactorService

Lower-level server service with the same persisted-user operations:

```ts
import { TwoFactor, TwoFactorService } from '@beeblock/svelar-two-factor/server';

const service = new TwoFactorService(TwoFactor.getConfig());
const setup = await service.generateSecret(user);
const confirmed = await service.confirmSetup(user, submittedCode);
const valid = service.verify(user, submittedCode);
```

Invalid digits, period, algorithm, recovery-code count, issuer, or window fail configuration validation.

### TOTP

Low-level TOTP implementation (RFC 6238):

```ts
import { TOTP } from '@beeblock/svelar-two-factor/server';

// Generate a TOTP code for the current time
const code = TOTP.generate(secret, { digits: 6, period: 30, algorithm: 'SHA1' });

// Verify a TOTP code with time window
const valid = TOTP.verify('123456', secret, {
  digits: 6,
  period: 30,
  algorithm: 'SHA1',
  window: 1,
});
```

### QRCode

Built-in QR code SVG generator with byte-mode versions 1–10 and error-correction level L:

```ts
import { QRCode } from '@beeblock/svelar-two-factor/server';

const svg = QRCode.generate(otpauthUrl, 4); // cell size 4; default four-module quiet margin
```

`QRCode.toSvg` renders an existing module matrix; `generate` encodes text. Payload and dimension limits fail explicitly.

### RecoveryCodes

Generate and manage recovery codes:

```ts
import { RecoveryCodes } from '@beeblock/svelar-two-factor/server';

// Generate N recovery codes
const codes: string[] = RecoveryCodes.generate(8);
// => ['abcde-fghij', ...] (random values)

// Hash codes for storage
const hashed: string[] = RecoveryCodes.hashAll(codes);

// Verify a recovery code against hashed codes
const { valid, index } = RecoveryCodes.verify(submittedCode, hashed);
// Low-level verify does not consume a code; use TwoFactor.verifyRecoveryCode for one-time use.
```

### HasTwoFactor Mixin

Adds 2FA fields and helpers to a Model:

```ts
class User extends HasTwoFactor(Model) {
  static table = 'users';
}

const user = await User.find(1);
user.two_factor_secret;        // string | null
user.two_factor_recovery_codes; // string | null (JSON-encoded)
user.two_factor_confirmed_at;  // string | null
user.hasTwoFactorEnabled();    // boolean
```

---

The mixin preserves model attribute access and removes secret, recovery hashes, and confirmation metadata from `toJSON`, even if the host overrides `hidden`. Return an explicit enabled boolean from an authorized server load rather than inspecting a serialized secret/confirmation field in the browser.

Host keys may be `string | number`, including UUID/ULID and custom primary-key names. The plugin reads `getAttribute(model.constructor.primaryKey)` for account labels, verification markers, rate-limit keys, and recovery consumption; it does not replace the host key or add a user foreign key. Integer and UUID/ULID `id` keys passed the installed candidate3 core authentication proof. A renamed key additionally requires a core `AuthManager` that honors the model's `primaryKey`; current core source implements that support, while the candidate3 native proof covered the plugin service/CAS for renamed keys. Verify the installed core build and keep session establishment in the public Auth API.

## Server-Side

### TwoFactorController

Successful responses use `{ data, meta }` and `Cache-Control: no-store`. Enable returns setup data, confirm/regenerate return `{ recoveryCodes }`, and verify/disable return an empty data object. Submit `{ code }` for TOTP or `{ recovery_code }` for recovery verification.

Handles all 2FA API endpoints:

| Method | Route | Description |
|---|---|---|
| `TwoFactorController.enable(event)` | `POST /api/two-factor?action=enable` | Start 2FA setup, returns secret + QR code |
| `TwoFactorController.confirm(event)` | `POST /api/two-factor?action=confirm` | Confirm setup with a TOTP code |
| `TwoFactorController.verify(event)` | `POST /api/two-factor?action=verify` | Verify a TOTP code during login |
| `TwoFactorController.disable(event)` | `DELETE /api/two-factor` | Disable with `{ code }` current TOTP proof |
| `TwoFactorController.regenerateRecoveryCodes(event)` | `POST /api/two-factor?action=recovery-codes` | Regenerate with `{ code }` current TOTP proof |

### TwoFactorMiddleware

After Svelar authentication has populated `event.locals.auth` and `event.locals.session`, check the challenge before resolving protected pages:

```ts
// hooks.server.ts: compose this after the application's authentication hook.
import { TwoFactorMiddleware } from '@beeblock/svelar-two-factor/server';

export async function handle({ event, resolve }) {
  const challenge = TwoFactorMiddleware.check(event, {
    redirectTo: '/two-factor-challenge',
    apiPrefix: '/api/two-factor',
    excludePaths: ['/logout'],
  });
  if (challenge) return challenge;
  return resolve(event);
}
```

The exact challenge page and POST verification operation remain reachable. Do not exclude a broad protected API prefix. Successful controller verification/confirmation calls `markVerified`: the public Auth API refreshes the persisted user and rotates the session, then the plugin stores an account/secret-bound verification marker. Account or secret changes invalidate that marker. The controller clears it after disabling.

---

## UI Components

### TwoFactorSetup

A controlled setup form. The application supplies setup data and an async callback; the component does not fetch an enable/confirm URL itself.

```svelte
<script lang='ts'>
  import { TwoFactorSetup } from '@beeblock/svelar-two-factor/ui';
  let { qrCodeSvg, secret, digits, onConfirm, error, loading } = $props();
</script>

<TwoFactorSetup {qrCodeSvg} {secret} {digits} {onConfirm} {error} {loading} />
```

Supported props also include `confirmed`, `class`, and a `children` snippet. QR SVG is displayed as an image, code length follows `digits`, and errors are inline.

### TwoFactorChallenge

A controlled challenge form with TOTP/recovery selection:

```svelte
<script lang='ts'>
  import { TwoFactorChallenge } from '@beeblock/svelar-two-factor/ui';
  let { onVerify, digits, error, loading } = $props();
</script>

<TwoFactorChallenge {onVerify} {digits} {error} {loading} />
```

`onVerify` receives `{ code }` or `{ recovery_code }`. The parent handles the authorized request and navigation after success.

### RecoveryCodes

Display, copy, and download plaintext recovery codes supplied by the authorized response:

```svelte
<script lang='ts'>
  import { RecoveryCodes } from '@beeblock/svelar-two-factor/ui';
  let { codes, onRegenerate, onClose, loading } = $props();
</script>

<RecoveryCodes {codes} {onRegenerate} {onClose} {loading} />
```

`onRegenerate` is a callback; obtain current TOTP proof in the parent and send it to the controller. The component does not accept a `regenerateUrl` prop.

---

## User Migration

The plugin publishes route stubs, not a user-table migration. Generate a focused application migration for the existing host table:

```bash
npx svelar make:migration add_two_factor_columns_to_users
```

```ts
import { Migration } from '@beeblock/svelar/database';

export default class AddTwoFactorColumnsToUsers extends Migration {
  async up() {
    await this.schema.addColumn('users', (table) => {
      table.text('two_factor_secret').nullable();
      table.text('two_factor_recovery_codes').nullable();
      table.string('two_factor_confirmed_at', 64).nullable(); // persisted ISO timestamp
    });
  }
  async down() {
    await this.schema.dropColumn('users', 'two_factor_confirmed_at');
    await this.schema.dropColumn('users', 'two_factor_recovery_codes');
    await this.schema.dropColumn('users', 'two_factor_secret');
  }
}
```

Run `npx svelar migrate`. Keep the host primary key unchanged. Existing applications need an application-owned migration; do not create or alter tables at runtime. TOTP secrets must remain recoverable for verification; their storage encryption/access policy belongs to the host application, while recovery codes are stored only as hashes.

---

## Full Working Example

Use the published query-dispatch route above and protect the settings page with authentication and two-factor middleware. Its authorized server load supplies `twoFactorEnabled`, the configured `digits`, and the route URL; it must not serialize the secret or recovery hashes.

```svelte
<!-- src/routes/settings/security/+page.svelte -->
<script lang='ts'>
  import { untrack } from 'svelte';
  import { apiFetch } from '@beeblock/svelar/http';
  import { TwoFactorSetup, RecoveryCodes } from '@beeblock/svelar-two-factor/ui';
  import type { TwoFactorSecret } from '@beeblock/svelar-two-factor';

  interface Props {
    data: { twoFactorEnabled: boolean; digits: number; twoFactorApiUrl: string };
  }
  let { data }: Props = $props();
  let enabled = $state(untrack(() => data.twoFactorEnabled));
  let setup = $state<TwoFactorSecret | null>(null);
  let codes = $state<string[]>([]);
  let currentCode = $state('');
  let loading = $state(false);
  let error = $state('');

  async function operation(action: string, body: Record<string, string> = {}) {
    if (loading) return;
    loading = true; error = '';
    try {
      const response = await apiFetch(data.twoFactorApiUrl + '?action=' + action, {
        method: 'POST', body: JSON.stringify(body), showToast: false,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.meta?.message ?? result.message ?? 'Unable to update two-factor authentication.');
      if (action === 'enable') setup = result.data;
      if (action === 'confirm' || action === 'recovery-codes') {
        enabled = true; codes = result.data.recoveryCodes; currentCode = ''; setup = null;
      }
    } catch (failure) { error = failure instanceof Error ? failure.message : 'Request failed.'; }
    finally { loading = false; }
  }
</script>

<h2>Two-Factor Authentication</h2>
{#if error && !setup}<p role='alert'>{error}</p>{/if}
{#if enabled}
  <p>Two-factor authentication is enabled.</p>
  <label>Current authenticator code
    <input bind:value={currentCode} inputmode='numeric' maxlength={data.digits} disabled={loading} />
  </label>
  <RecoveryCodes {codes} {loading} onRegenerate={() => operation('recovery-codes', { code: currentCode })} />
{:else if setup}
  <TwoFactorSetup qrCodeSvg={setup.qrCodeSvg} secret={setup.secret} digits={data.digits}
    {loading} {error} onConfirm={(code) => operation('confirm', { code })} />
{:else}
  <button type='button' disabled={loading} onclick={() => operation('enable')}>Set up two-factor authentication</button>
{/if}
```

```svelte
<!-- src/routes/two-factor-challenge/+page.svelte -->
<script lang='ts'>
  import { apiFetch } from '@beeblock/svelar/http';
  import { TwoFactorChallenge } from '@beeblock/svelar-two-factor/ui';
  let { data } = $props(); // trusted server data: api URL, digits, local success path
  let loading = $state(false);
  let error = $state('');

  async function verify(payload: { code?: string; recovery_code?: string }) {
    if (loading) return;
    loading = true; error = '';
    try {
      const response = await apiFetch(data.twoFactorApiUrl + '?action=verify', {
        method: 'POST', body: JSON.stringify(payload), showToast: false,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.meta?.message ?? result.message ?? 'Invalid verification code.');
      window.location.assign(data.afterVerificationUrl);
    } catch (failure) { error = failure instanceof Error ? failure.message : 'Request failed.'; }
    finally { loading = false; }
  }
</script>

<h1>Two-Factor Verification</h1>
<p>Enter your authenticator or recovery code.</p>
<TwoFactorChallenge digits={data.digits} {loading} {error} onVerify={verify} />
```

`apiFetch` attaches the same-origin CSRF header. Keep errors inline without duplicate validation toasts, clear plaintext setup/recovery state when leaving the page, and keep all account mutations in the controller/action flow.
