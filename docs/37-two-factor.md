# Two-Factor Authentication Plugin

TOTP-based two-factor authentication plugin for Svelar/SvelteKit with QR code generation, recovery codes, and pre-built UI components for setup, verification, and recovery. Zero external dependencies for QR code and TOTP generation.

**Package:** `@beeblock/svelar-two-factor`

**Install:**

```bash
npx svelar plugin:install @beeblock/svelar-two-factor
```

**Imports:**

```ts
// Plugin registration
import { SvelarTwoFactorPlugin } from '@beeblock/svelar-two-factor/server';

// Core API
import { TwoFactor, TwoFactorService, TOTP, QRCode, RecoveryCodes, HasTwoFactor } from '@beeblock/svelar-two-factor';

// Server-side (controller, middleware)
import { TwoFactorController, TwoFactorMiddleware } from '@beeblock/svelar-two-factor/server';

// UI components
import { TwoFactorSetup, TwoFactorChallenge, RecoveryCodes as RecoveryCodesUI } from '@beeblock/svelar-two-factor/ui';

// Types
import type { TwoFactorConfig, TwoFactorPluginConfig } from '@beeblock/svelar-two-factor';
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
  recoveryCodesCount: 8,
  window: 1,
});
```

### 2. Add to Your User Model

```ts
import { Model } from '@beeblock/svelar/orm';
import { HasTwoFactor } from '@beeblock/svelar-two-factor';

class User extends HasTwoFactor(Model) {
  static table = 'users';

  hasTwoFactorEnabled(): boolean {
    return Boolean(this.getAttribute('two_factor_secret') && this.getAttribute('two_factor_confirmed_at'));
  }
}
```

### 3. Set Up API Routes

```ts
// src/routes/api/two-factor/+server.ts
import { TwoFactorController } from '@beeblock/svelar-two-factor/server';

export const POST = async (event) => TwoFactorController.enable(event);
export const DELETE = async (event) => TwoFactorController.disable(event);
```

```ts
// src/routes/api/two-factor/confirm/+server.ts
import { TwoFactorController } from '@beeblock/svelar-two-factor/server';

export const POST = async (event) => TwoFactorController.confirm(event);
```

```ts
// src/routes/api/two-factor/verify/+server.ts
import { TwoFactorController } from '@beeblock/svelar-two-factor/server';

export const POST = async (event) => TwoFactorController.verify(event);
```

---

## Configuration

The `SvelarTwoFactorPlugin` constructor accepts:

| Option | Type | Default | Description |
|---|---|---|---|
| `issuer` | `string` | `'Svelar'` | Issuer name shown in authenticator apps |
| `digits` | `number` | `6` | Number of digits in the TOTP code |
| `period` | `number` | `30` | TOTP code validity period in seconds |
| `algorithm` | `string` | `'SHA1'` | HMAC algorithm (`SHA1`, `SHA256`, `SHA512`) |
| `recoveryCodesCount` | `number` | `8` | Number of recovery codes to generate |
| `window` | `number` | `1` | Time step window for TOTP validation (allows +/- N steps) |
| `prefix` | `string` | `'/api'` | API route prefix |

---

## Core API

### TwoFactor Facade

```ts
import { TwoFactor } from '@beeblock/svelar-two-factor';

// Configure (done automatically by plugin)
TwoFactor.configure({
  issuer: 'MyApp',
  digits: 6,
  period: 30,
});

// Enable 2FA for a user — returns secret and QR code
const setup = await TwoFactor.enable(user);
// setup.secret   — base32-encoded secret
// setup.qrCode   — SVG string of the QR code
// setup.otpauthUrl — otpauth:// URI
// setup.recoveryCodes — string[] of recovery codes

// Confirm 2FA setup with a TOTP code from the user
await TwoFactor.confirm(user, '123456');

// Verify a TOTP code during login
const valid = await TwoFactor.verify(user, '123456');

// Verify using a recovery code
const valid = await TwoFactor.verifyRecoveryCode(user, 'ABCD-EFGH');

// Disable 2FA for a user
await TwoFactor.disable(user);

// Regenerate recovery codes
const newCodes = await TwoFactor.regenerateRecoveryCodes(user);
```

### TwoFactorService

Lower-level service with direct access:

```ts
import { TwoFactorService } from '@beeblock/svelar-two-factor';

const service = new TwoFactorService(config);

const secret = service.generateSecret();
const otpauthUrl = service.buildOtpauthUrl(secret, 'user@example.com');
const qrSvg = service.generateQrCode(otpauthUrl);
const isValid = service.verifyCode(secret, '123456');
```

### TOTP

Low-level TOTP implementation (RFC 6238):

```ts
import { TOTP } from '@beeblock/svelar-two-factor';

// Generate a TOTP code for the current time
const code = TOTP.generate(secret, { digits: 6, period: 30, algorithm: 'SHA1' });

// Verify a TOTP code with time window
const valid = TOTP.verify(secret, '123456', {
  digits: 6,
  period: 30,
  algorithm: 'SHA1',
  window: 1,
});
```

### QRCode

Built-in QR code SVG generator (no external dependencies):

```ts
import { QRCode } from '@beeblock/svelar-two-factor';

const svg = QRCode.toSvg('otpauth://totp/MyApp:user@example.com?secret=BASE32SECRET&issuer=MyApp', {
  width: 200,
  margin: 4,
});
```

### RecoveryCodes

Generate and manage recovery codes:

```ts
import { RecoveryCodes } from '@beeblock/svelar-two-factor';

// Generate N recovery codes
const codes: string[] = RecoveryCodes.generate(8);
// => ['ABCD-EFGH', 'IJKL-MNOP', ...]

// Hash codes for storage
const hashed: string[] = await RecoveryCodes.hash(codes);

// Verify a recovery code against hashed codes
const { valid, remaining } = await RecoveryCodes.verify('ABCD-EFGH', hashedCodes);
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

## Server-Side

### TwoFactorController

Handles all 2FA API endpoints:

| Method | Route | Description |
|---|---|---|
| `TwoFactorController.enable(event)` | `POST /api/two-factor` | Start 2FA setup, returns secret + QR code |
| `TwoFactorController.confirm(event)` | `POST /api/two-factor/confirm` | Confirm setup with a TOTP code |
| `TwoFactorController.verify(event)` | `POST /api/two-factor/verify` | Verify a TOTP code during login |
| `TwoFactorController.disable(event)` | `DELETE /api/two-factor` | Disable 2FA |
| `TwoFactorController.recoveryCodes(event)` | `GET /api/two-factor/recovery-codes` | Get recovery codes |
| `TwoFactorController.regenerateRecoveryCodes(event)` | `POST /api/two-factor/recovery-codes` | Regenerate recovery codes |

### TwoFactorMiddleware

Middleware that enforces 2FA verification:

```ts
// hooks.server.ts
import { TwoFactorMiddleware } from '@beeblock/svelar-two-factor/server';

// Add to your middleware chain
// This middleware checks if the user has 2FA enabled but hasn't verified
// in the current session, and redirects to the challenge page.
const twoFactorMiddleware = new TwoFactorMiddleware({
  challengeUrl: '/two-factor/challenge',
  excludePaths: ['/two-factor', '/logout', '/api'],
});
```

---

## UI Components

### TwoFactorSetup

Full setup flow with QR code display and code confirmation:

```svelte
<script lang="ts">
  import { TwoFactorSetup } from '@beeblock/svelar-two-factor/ui';
</script>

<TwoFactorSetup
  enableUrl="/api/two-factor"
  confirmUrl="/api/two-factor/confirm"
  onComplete={() => console.log('2FA enabled!')}
/>
```

### TwoFactorChallenge

Verification form for login challenge:

```svelte
<script lang="ts">
  import { TwoFactorChallenge } from '@beeblock/svelar-two-factor/ui';
</script>

<TwoFactorChallenge
  verifyUrl="/api/two-factor/verify"
  onSuccess={() => window.location.href = '/dashboard'}
  onError={(msg) => console.error(msg)}
  showRecoveryOption={true}
/>
```

### RecoveryCodes

Display and copy recovery codes:

```svelte
<script lang="ts">
  import { RecoveryCodes } from '@beeblock/svelar-two-factor/ui';
</script>

<RecoveryCodes
  codes={['ABCD-EFGH', 'IJKL-MNOP', 'QRST-UVWX']}
  regenerateUrl="/api/two-factor/recovery-codes"
/>
```

---

## Migration SQL

Add 2FA columns to your `users` table:

```sql
ALTER TABLE users ADD COLUMN two_factor_secret TEXT;
ALTER TABLE users ADD COLUMN two_factor_recovery_codes TEXT;
ALTER TABLE users ADD COLUMN two_factor_confirmed_at TEXT;
```

---

## Full Working Example

```ts
// src/lib/plugins.ts
import { SvelarTwoFactorPlugin } from '@beeblock/svelar-two-factor/server';

export const twoFactorPlugin = new SvelarTwoFactorPlugin({
  issuer: 'MyApp',
  digits: 6,
  period: 30,
  recoveryCodesCount: 8,
});
```

```ts
// src/routes/api/two-factor/+server.ts
import { TwoFactorController } from '@beeblock/svelar-two-factor/server';

export const POST = async (event) => TwoFactorController.enable(event);
export const DELETE = async (event) => TwoFactorController.disable(event);
```

```ts
// src/routes/api/two-factor/confirm/+server.ts
import { TwoFactorController } from '@beeblock/svelar-two-factor/server';

export const POST = async (event) => TwoFactorController.confirm(event);
```

```svelte
<!-- src/routes/settings/security/+page.svelte -->
<script lang="ts">
  import { TwoFactorSetup } from '@beeblock/svelar-two-factor/ui';
  import { RecoveryCodes } from '@beeblock/svelar-two-factor/ui';

  interface Props {
    data: { user: any };
  }
  let { data }: Props = $props();
  let enabled = $state(data.user.two_factor_confirmed_at !== null);
  let recoveryCodes = $state<string[]>([]);

  function handleComplete() {
    enabled = true;
  }
</script>

<h2>Two-Factor Authentication</h2>

{#if enabled}
  <p>Two-factor authentication is enabled.</p>
  <RecoveryCodes
    codes={recoveryCodes}
    regenerateUrl="/api/two-factor/recovery-codes"
  />
{:else}
  <TwoFactorSetup
    enableUrl="/api/two-factor"
    confirmUrl="/api/two-factor/confirm"
    onComplete={handleComplete}
  />
{/if}
```

```svelte
<!-- src/routes/two-factor/challenge/+page.svelte -->
<script lang="ts">
  import { TwoFactorChallenge } from '@beeblock/svelar-two-factor/ui';
</script>

<h1>Two-Factor Verification</h1>
<p>Enter the code from your authenticator app.</p>

<TwoFactorChallenge
  verifyUrl="/api/two-factor/verify"
  onSuccess={() => window.location.href = '/dashboard'}
  showRecoveryOption={true}
/>
```
