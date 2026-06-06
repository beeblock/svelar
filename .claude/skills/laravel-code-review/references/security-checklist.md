# Security Review Checklist

This checklist focuses specifically on security concerns in Laravel applications. Use this when conducting security-focused reviews or audits.

## Table of Contents
- [Injection Vulnerabilities](#injection-vulnerabilities)
- [Authentication](#authentication)
- [Authorization](#authorization)
- [Session Management](#session-management)
- [Cryptography](#cryptography)
- [Data Protection](#data-protection)
- [API Security](#api-security)
- [File Upload Security](#file-upload-security)

## Injection Vulnerabilities

### SQL Injection

- [ ] No raw SQL with unescaped user input
- [ ] Query builder or Eloquent used (automatically parameterized)
- [ ] `whereRaw()`, `selectRaw()`, etc. use bindings parameter
- [ ] Dynamic table/column names validated against whitelist
- [ ] No string concatenation in queries

```php
// ❌ Vulnerable
$email = $request->input('email');
DB::select("SELECT * FROM users WHERE email = '$email'");

// ✅ Safe
DB::select('SELECT * FROM users WHERE email = ?', [$email]);
User::where('email', $email)->get();
```

### XSS (Cross-Site Scripting)

- [ ] Output escaped by default (`{{ }}` in Blade)
- [ ] `{!! !!}` only used for trusted, sanitized content
- [ ] User content sanitized before display (use library like HTMLPurifier)
- [ ] JSON responses properly encoded
- [ ] Content-Type headers set correctly

```php
// ❌ Vulnerable
<div>{!! $userComment !!}</div>

// ✅ Safe
<div>{{ $userComment }}</div>

// ✅ If HTML needed, sanitize
<div>{!! clean($userComment) !!}</div>
```

### Command Injection

- [ ] No shell commands with unsanitized user input
- [ ] Use PHP functions instead of shell commands when possible
- [ ] `escapeshellarg()` used if shell commands necessary
- [ ] Artisan commands validate input

```php
// ❌ Vulnerable
$filename = $request->input('file');
exec("cat /var/logs/{$filename}");

// ✅ Safe
$filename = $request->input('file');
$safeName = basename($filename); // Remove path traversal
$content = file_get_contents("/var/logs/{$safeName}");
```

## Authentication

### Password Security

- [ ] Passwords hashed with bcrypt or argon2 (Laravel default)
- [ ] Never store passwords in plain text
- [ ] Password reset tokens expire
- [ ] Password reset tokens single-use
- [ ] Strong password requirements enforced

```php
// ✅ Good: Password validation
'password' => [
    'required',
    'string',
    'min:12',
    'regex:/[a-z]/',      // lowercase
    'regex:/[A-Z]/',      // uppercase
    'regex:/[0-9]/',      // numbers
    'regex:/[@$!%*#?&]/', // special chars
    'confirmed',
],
```

### Login Security

- [ ] Rate limiting on login attempts (throttle middleware)
- [ ] Account lockout after failed attempts
- [ ] Two-factor authentication available for sensitive accounts
- [ ] Remember me token properly secured
- [ ] Session invalidated on logout

```php
// ✅ Good: Rate limiting
Route::post('/login', [AuthController::class, 'login'])
    ->middleware('throttle:5,1'); // 5 attempts per minute
```

### Session Fixation

- [ ] Session regenerated after login
- [ ] Session regenerated after privilege escalation
- [ ] Old session data cleared

```php
// ✅ Good: Regenerate session
public function login(Request $request)
{
    if (Auth::attempt($request->only('email', 'password'))) {
        $request->session()->regenerate(); // Prevent session fixation
        return redirect()->intended('dashboard');
    }

    return back()->withErrors(['email' => 'Invalid credentials']);
}
```

## Authorization

### Access Control

- [ ] Authorization checked before every protected action
- [ ] Policies used for model authorization
- [ ] Gates used for feature-based authorization
- [ ] Can't access other users' data without proper checks
- [ ] Insecure Direct Object References (IDOR) prevented

```php
// ❌ Vulnerable: No authorization check
public function show(Order $order)
{
    return view('orders.show', compact('order'));
}

// ✅ Safe: Policy check
public function show(Order $order)
{
    $this->authorize('view', $order);
    return view('orders.show', compact('order'));
}

// Policy
public function view(User $user, Order $order): bool
{
    return $user->id === $order->user_id;
}
```

### Privilege Escalation

- [ ] Role/permission changes properly authorized
- [ ] Admin actions require admin authentication
- [ ] No direct manipulation of user roles via input
- [ ] Privilege changes logged for audit

```php
// ❌ Vulnerable
public function updateRole(Request $request, User $user)
{
    $user->update(['role' => $request->role]); // No authorization!
}

// ✅ Safe
public function updateRole(Request $request, User $user)
{
    $this->authorize('updateRole', $user);

    $user->update(['role' => $request->validated('role')]);

    Log::info("Role changed for user {$user->id} by " . auth()->id());
}
```

## Session Management

### Session Configuration

- [ ] Session lifetime appropriate for application sensitivity
- [ ] Sessions use secure cookies in production
- [ ] HttpOnly flag set on session cookies
- [ ] SameSite attribute configured
- [ ] Session driver secure (database/redis, not file in production)

```php
// config/session.php
'lifetime' => 120, // 2 hours
'expire_on_close' => false,
'secure' => env('SESSION_SECURE_COOKIE', true), // HTTPS only
'http_only' => true, // Not accessible via JavaScript
'same_site' => 'lax', // CSRF protection
```

### CSRF Protection

- [ ] CSRF middleware enabled for web routes
- [ ] CSRF token in all state-changing forms
- [ ] API routes use token authentication (not CSRF)
- [ ] CSRF token verified on all POST/PUT/DELETE requests

```blade
// ✅ CSRF token in form
<form method="POST" action="/orders">
    @csrf
    <!-- form fields -->
</form>
```

## Cryptography

### Encryption

- [ ] APP_KEY properly set and secured
- [ ] Sensitive data encrypted at rest
- [ ] Laravel's encrypt() helper used for encryption
- [ ] No homegrown crypto implementations
- [ ] Encryption keys rotated periodically

```php
// ✅ Good: Encrypting sensitive data
$user->ssn = encrypt($request->ssn);
$user->save();

// Decrypting
$ssn = decrypt($user->ssn);
```

### Hashing

- [ ] Passwords hashed, not encrypted
- [ ] bcrypt or argon2 used for password hashing
- [ ] Hash::check() used for verification
- [ ] Sensitive identifiers hashed when needed

## Data Protection

### Mass Assignment

- [ ] All models have $fillable or $guarded defined
- [ ] Sensitive fields in $guarded
- [ ] No $guarded = [] (unprotected)
- [ ] Request validation matches mass assignment rules

```php
// ✅ Good: Protected model
class User extends Model
{
    protected $fillable = [
        'name',
        'email',
        'password',
    ];

    protected $guarded = [
        'is_admin',
        'role',
        'email_verified_at',
    ];
}
```

### Sensitive Data Exposure

- [ ] No sensitive data in logs
- [ ] No passwords, tokens, or keys in version control
- [ ] .env file in .gitignore
- [ ] Error messages don't reveal sensitive info
- [ ] Debug mode off in production
- [ ] API responses don't leak internal data

```php
// ✅ Good: Hide sensitive attributes
class User extends Model
{
    protected $hidden = [
        'password',
        'remember_token',
        'two_factor_secret',
    ];
}
```

### Data Validation

- [ ] All user input validated
- [ ] Validation rules appropriate and strict
- [ ] Type checking performed
- [ ] Length limits enforced
- [ ] Email addresses validated
- [ ] URLs validated

## API Security

### Authentication

- [ ] API uses token-based authentication (Sanctum/Passport)
- [ ] Tokens expire appropriately
- [ ] Tokens stored securely
- [ ] No tokens in URLs or logs
- [ ] Bearer token authentication used

```php
// ✅ Good: API routes with authentication
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/user', [UserController::class, 'show']);
    Route::post('/orders', [OrderController::class, 'store']);
});
```

### Rate Limiting

- [ ] Rate limiting on all API endpoints
- [ ] Stricter limits on authentication endpoints
- [ ] Rate limit headers included in response
- [ ] Per-user rate limiting for authenticated routes

```php
// ✅ Good: Rate limiting
Route::middleware(['auth:sanctum', 'throttle:60,1'])->group(function () {
    // 60 requests per minute
    Route::apiResource('orders', OrderController::class);
});

Route::post('/login')->middleware('throttle:5,1');
```

### CORS

- [ ] CORS properly configured
- [ ] Allowed origins explicitly listed (not *)
- [ ] Credentials allowed only for trusted origins
- [ ] Preflight requests handled

```php
// config/cors.php
'allowed_origins' => [
    'https://yourdomain.com',
    // Not '*' in production!
],

'supports_credentials' => true,
```

## File Upload Security

### Upload Validation

- [ ] File type validated (not just extension)
- [ ] File size limited
- [ ] MIME type checked
- [ ] File content validated
- [ ] Malicious filenames rejected

```php
// ✅ Good: File validation
$request->validate([
    'avatar' => [
        'required',
        'file',
        'mimes:jpg,jpeg,png',
        'max:2048', // 2MB
        'dimensions:min_width=100,min_height=100',
    ],
]);
```

### Upload Storage

- [ ] Uploaded files stored outside web root
- [ ] Files not executable
- [ ] Random filenames used
- [ ] Files scanned for malware if possible
- [ ] Old uploads cleaned up

```php
// ✅ Good: Secure file storage
$path = $request->file('avatar')->store('avatars', 'private');
// Stored in storage/app/private/avatars with random name
```

### Download Security

- [ ] Authorization checked before file download
- [ ] Path traversal attacks prevented
- [ ] Proper Content-Type headers set
- [ ] Content-Disposition header set

```php
// ✅ Good: Secure file download
public function download(Document $document)
{
    $this->authorize('download', $document);

    return Storage::download(
        $document->path,
        $document->original_name,
        ['Content-Type' => $document->mime_type]
    );
}
```

## General Security Practices

### Logging & Monitoring

- [ ] Security events logged (login, permission changes, etc.)
- [ ] Failed authentication attempts logged
- [ ] Anomalous activity monitored
- [ ] Logs don't contain sensitive data
- [ ] Log access restricted

### Dependencies

- [ ] Dependencies regularly updated
- [ ] Security advisories monitored
- [ ] composer.lock in version control
- [ ] No known vulnerabilities in dependencies

```bash
# Check for vulnerabilities
composer audit
```

### Server Configuration

- [ ] HTTPS enforced in production
- [ ] Security headers configured (CSP, X-Frame-Options, etc.)
- [ ] PHP display_errors off in production
- [ ] Unnecessary services disabled
- [ ] File permissions properly set

```php
// config/secure-headers.php or middleware
'Content-Security-Policy' => "default-src 'self'",
'X-Frame-Options' => 'SAMEORIGIN',
'X-Content-Type-Options' => 'nosniff',
'X-XSS-Protection' => '1; mode=block',
```
