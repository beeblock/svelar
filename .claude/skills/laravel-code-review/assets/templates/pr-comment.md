# PR Comment Templates

Use these templates for inline PR comments.

## Architecture Issues

### Fat Controller
```markdown
**[Important]** This controller has significant business logic that should be extracted.

Consider moving this logic to a dedicated Action class:

1. Create `App\Domain\Orders\Actions\CreateOrderAction`
2. Move business logic there
3. Keep controller thin - just orchestration

Example:
```php
class OrderController
{
    public function store(CreateOrderRequest $request, CreateOrderAction $action)
    {
        $dto = CreateOrderDTO::fromRequest($request);
        $order = $action->execute($dto);
        return new OrderResource($order);
    }
}
```

This improves testability and follows Single Responsibility Principle.
```

### Layer Violation
```markdown
**[Critical]** Domain layer depending on Infrastructure layer.

This violates the dependency inversion principle. Domain should depend on abstractions:

Instead of:
```php
use App\Infrastructure\Orders\Models\OrderModel;
```

Define an interface in Domain:
```php
namespace App\Domain\Orders\Repositories;

interface OrderRepositoryInterface
{
    public function find(string $id): ?Order;
    public function save(Order $order): void;
}
```

Then inject the interface, not the concrete implementation.
```

## Security Issues

### SQL Injection
```markdown
**[Critical]** SQL injection vulnerability detected.

This code is vulnerable to SQL injection attacks:
```php
DB::select("SELECT * FROM users WHERE email = '$email'");
```

Fix by using parameterized queries:
```php
DB::select('SELECT * FROM users WHERE email = ?', [$email]);
```

Or better yet, use Eloquent:
```php
User::where('email', $email)->get();
```

Never concatenate user input into SQL queries.
```

### Missing Authorization
```markdown
**[Required]** Missing authorization check.

This endpoint allows any authenticated user to access any order. Add authorization:

```php
public function show(Order $order)
{
    $this->authorize('view', $order);
    return new OrderResource($order);
}
```

And implement the policy:
```php
// OrderPolicy
public function view(User $user, Order $order): bool
{
    return $user->id === $order->user_id;
}
```
```

### XSS Vulnerability
```markdown
**[Critical]** XSS vulnerability - unescaped user content.

Using `{!! !!}` with user-generated content allows script injection:
```blade
{!! $comment->body !!}
```

Fix by escaping:
```blade
{{ $comment->body }}
```

If HTML is needed, sanitize first:
```blade
{!! clean($comment->body) !!}
```
```

## Performance Issues

### N+1 Query
```markdown
**[Warning]** N+1 query problem detected.

This code will generate N+1 queries:
```php
$orders = Order::all();
foreach ($orders as $order) {
    echo $order->customer->name; // Extra query per order!
}
```

Fix with eager loading:
```php
$orders = Order::with('customer')->get();
foreach ($orders as $order) {
    echo $order->customer->name; // No extra queries
}
```

For nested relationships:
```php
Order::with(['customer', 'items.product'])->get();
```
```

### Missing Caching
```markdown
**[Suggestion]** Consider caching this expensive query.

This query runs complex aggregations that don't change frequently:

```php
return Cache::remember('dashboard-stats', 3600, function () {
    return Order::where('created_at', '>', now()->subYear())
        ->with('items')
        ->get()
        ->groupBy('status')
        ->map->count();
});
```

Add cache invalidation when orders are created/updated.
```

## Testing Issues

### Missing Tests
```markdown
**[Required]** Missing tests for critical business logic.

This payment processing logic needs comprehensive Pest tests:

1. **Unit tests** for calculation logic:
```php
test('calculates order total with tax', function () {
    $order = Order::create(...);
    expect($order->total())->toEqual(Money::USD(11000));
});
```

2. **Feature test** for the endpoint:
```php
test('user can create order', function () {
    $response = $this->postJson('/api/orders', [...]);
    $response->assertStatus(201);
});
```

3. **Edge cases**: zero amount, negative values, overflow
4. **Error cases**: invalid payment method, insufficient funds
```

### Poor Test Quality
```markdown
**[Suggestion]** This test could be clearer and more focused.

Current test checks multiple unrelated things. Consider splitting:

Instead of:
```php
test('order works', function () {
    // Tests total, status, items all at once
});
```

Split into focused tests:
```php
test('order calculates total correctly', function () {
    // Just test total calculation
});

test('new order has pending status', function () {
    // Just test initial status
});
```

Each test should verify one specific behavior.
```

## Code Quality Issues

### Long Method
```markdown
**[Minor]** This method is quite long and does multiple things.

Consider extracting smaller, focused methods:

```php
// Instead of one 80-line method:
public function processOrder(Request $request) { /* 80 lines */ }

// Extract to:
public function processOrder(Request $request)
{
    $this->validateOrder($request);
    $order = $this->createOrder($request);
    $this->sendConfirmation($order);
    return $order;
}

private function validateOrder(Request $request) { /* ... */ }
private function createOrder(Request $request) { /* ... */ }
private function sendConfirmation(Order $order) { /* ... */ }
```

Easier to read, test, and maintain.
```

### Primitive Obsession
```markdown
**[Suggestion]** Consider using a Value Object instead of primitives.

Instead of passing around int cents and string currency code:
```php
public function calculate(int $cents, string $currency): array
```

Create a Money value object:
```php
readonly class Money
{
    public function __construct(
        public int $cents,
        public Currency $currency,
    ) {}

    public static function USD(int $cents): self
    {
        return new self($cents, Currency::USD);
    }
}

public function calculate(Money $amount): Money
```

More type-safe, self-documenting, and domain-focused.
```

## Positive Feedback

### Good Architecture
```markdown
**[Good]** Excellent separation of concerns!

Love seeing:
- Thin controller that just orchestrates
- Business logic in dedicated Action class
- Proper use of DTOs for data transfer
- Clean dependency injection

This makes the code testable, maintainable, and follows SOLID principles well.
```

### Good Tests
```markdown
**[Good]** Great Pest test coverage!

Especially like:
- Clear, descriptive test names
- Proper AAA structure (Arrange, Act, Assert)
- Good coverage of edge cases
- Effective use of Pest expectations

Well-written tests like these make the codebase more maintainable.
```
