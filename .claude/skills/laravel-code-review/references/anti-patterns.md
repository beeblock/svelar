# Common Laravel Anti-Patterns

This document catalogs common mistakes and anti-patterns in Laravel applications with examples of how to fix them.

## Table of Contents
- [Architecture Anti-Patterns](#architecture-anti-patterns)
- [Eloquent Anti-Patterns](#eloquent-anti-patterns)
- [Controller Anti-Patterns](#controller-anti-patterns)
- [Security Anti-Patterns](#security-anti-patterns)
- [Performance Anti-Patterns](#performance-anti-patterns)
- [Testing Anti-Patterns](#testing-anti-patterns)

## Architecture Anti-Patterns

### Fat Controllers

Controllers should be thin orchestrators, not business logic containers.

```php
// ❌ Bad: Business logic in controller
class OrderController extends Controller
{
    public function store(Request $request)
    {
        // Validation
        $validated = $request->validate([...]);

        // Complex business logic
        $total = 0;
        foreach ($validated['items'] as $item) {
            $product = Product::find($item['id']);
            $total += $product->price * $item['quantity'];
        }

        // Tax calculation
        $tax = $total * 0.1;
        $finalTotal = $total + $tax;

        // Discount logic
        if ($finalTotal > 100) {
            $finalTotal *= 0.9;
        }

        // Create order
        $order = Order::create([
            'user_id' => auth()->id(),
            'total' => $finalTotal,
        ]);

        // Send email
        Mail::to($order->user)->send(new OrderConfirmation($order));

        return response()->json($order);
    }
}

// ✅ Good: Thin controller
class OrderController extends Controller
{
    public function store(CreateOrderRequest $request, CreateOrderAction $action)
    {
        $dto = CreateOrderDTO::fromRequest($request);
        $order = $action->execute($dto);

        return new OrderResource($order);
    }
}
```

### Domain Logic in Models

Eloquent models are infrastructure, not domain entities.

```php
// ❌ Bad: Domain logic in Eloquent model
class Order extends Model
{
    public function calculateTotal()
    {
        $subtotal = $this->items->sum(fn($item) => $item->price * $item->quantity);
        $tax = $subtotal * 0.1;
        return $subtotal + $tax;
    }

    public function applyDiscount($percentage)
    {
        if ($this->total > 100) {
            $this->total *= (1 - $percentage);
            $this->save();
        }
    }
}

// ✅ Good: Domain entity with logic
namespace App\Domain\Orders\Entities;

class Order
{
    public function __construct(
        public readonly string $id,
        public readonly string $customerId,
        private array $items,
    ) {}

    public function total(): Money
    {
        $subtotal = array_reduce(
            $this->items,
            fn($sum, $item) => $sum->add($item->lineTotal()),
            Money::USD(0)
        );

        return $subtotal->addTax(0.1);
    }

    public function applyDiscount(Percentage $discount): self
    {
        if ($this->total()->isGreaterThan(Money::USD(10000))) {
            return new self(
                $this->id,
                $this->customerId,
                $this->items,
                $discount
            );
        }

        return $this;
    }
}
```

### Service Locator Pattern

Avoid using facades and `app()` for dependency resolution inside classes.

```php
// ❌ Bad: Service locator
class OrderService
{
    public function createOrder(array $data)
    {
        $repository = app(OrderRepository::class);
        $mailer = app(MailService::class);

        $order = $repository->create($data);
        $mailer->sendConfirmation($order);

        return $order;
    }
}

// ✅ Good: Constructor injection
class CreateOrderAction
{
    public function __construct(
        private OrderRepositoryInterface $repository,
        private MailServiceInterface $mailer,
    ) {}

    public function execute(CreateOrderDTO $dto): Order
    {
        $order = Order::create($dto->customerId, $dto->items);
        $this->repository->save($order);
        $this->mailer->sendConfirmation($order);

        return $order;
    }
}
```

### Tight Coupling Between Modules

Modules should communicate through interfaces, not direct dependencies.

```php
// ❌ Bad: Direct module dependency
namespace App\Domain\Orders;

use App\Domain\Billing\Services\PaymentProcessor;

class CreateOrderAction
{
    public function __construct(
        private PaymentProcessor $paymentProcessor // Direct dependency!
    ) {}
}

// ✅ Good: Dependency on interface
namespace App\Domain\Orders;

use App\Domain\Orders\Contracts\PaymentServiceInterface;

class CreateOrderAction
{
    public function __construct(
        private PaymentServiceInterface $paymentService // Interface!
    ) {}
}

// Billing module implements the interface
namespace App\Domain\Billing\Services;

use App\Domain\Orders\Contracts\PaymentServiceInterface;

class PaymentService implements PaymentServiceInterface
{
    // Implementation
}
```

## Eloquent Anti-Patterns

### N+1 Query Problem

The most common performance issue in Laravel applications.

```php
// ❌ Bad: N+1 queries
$orders = Order::all(); // 1 query

foreach ($orders as $order) {
    echo $order->customer->name; // N queries
    foreach ($order->items as $item) { // N more queries
        echo $item->product->name;
    }
}

// ✅ Good: Eager loading
$orders = Order::with(['customer', 'items.product'])->get(); // 3 queries total

foreach ($orders as $order) {
    echo $order->customer->name;
    foreach ($order->items as $item) {
        echo $item->product->name;
    }
}
```

### Unprotected Mass Assignment

Always protect models from mass assignment vulnerabilities.

```php
// ❌ Bad: Unprotected model
class User extends Model
{
    // No $fillable or $guarded!
}

// Attacker can do:
User::create($request->all()); // Could set 'is_admin' => true

// ✅ Good: Protected attributes
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
    ];
}
```

### Query Builder Abuse

Don't use query builder for complex business logic.

```php
// ❌ Bad: Complex query in controller
$highValueOrders = Order::where('status', 'completed')
    ->whereHas('items', function ($query) {
        $query->where('price', '>', 100);
    })
    ->where('created_at', '>', now()->subDays(30))
    ->withSum('items', 'price')
    ->having('items_sum_price', '>', 1000)
    ->get();

// ✅ Good: Query scope on model
class Order extends Model
{
    public function scopeHighValue($query)
    {
        return $query->where('status', 'completed')
            ->whereHas('items', fn($q) => $q->where('price', '>', 100))
            ->where('created_at', '>', now()->subDays(30))
            ->withSum('items', 'price')
            ->having('items_sum_price', '>', 1000);
    }
}

// Usage
$orders = Order::highValue()->get();
```

## Controller Anti-Patterns

### Not Using Form Requests

Form Requests centralize validation and authorization.

```php
// ❌ Bad: Validation in controller
class OrderController extends Controller
{
    public function store(Request $request)
    {
        $validated = $request->validate([
            'customer_id' => 'required|exists:customers,id',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|exists:products,id',
            'items.*.quantity' => 'required|integer|min:1',
        ]);

        // More logic...
    }
}

// ✅ Good: Form Request
class CreateOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', Order::class);
    }

    public function rules(): array
    {
        return [
            'customer_id' => ['required', 'exists:customers,id'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.product_id' => ['required', 'exists:products,id'],
            'items.*.quantity' => ['required', 'integer', 'min:1'],
        ];
    }
}

class OrderController extends Controller
{
    public function store(CreateOrderRequest $request, CreateOrderAction $action)
    {
        // Request is already validated and authorized
        $order = $action->execute(CreateOrderDTO::fromRequest($request));
        return new OrderResource($order);
    }
}
```

### Returning Models Directly

Use API Resources for consistent response formatting.

```php
// ❌ Bad: Returning model directly
public function show(Order $order)
{
    return $order; // Exposes all attributes, including sensitive ones
}

// ✅ Good: Using API Resource
public function show(Order $order)
{
    return new OrderResource($order);
}

class OrderResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->id,
            'total' => $this->total,
            'status' => $this->status,
            'items' => OrderItemResource::collection($this->items),
            // Controlled output
        ];
    }
}
```

## Security Anti-Patterns

### SQL Injection via Raw Queries

Always use parameter binding with raw queries.

```php
// ❌ Bad: SQL injection vulnerability
$email = $request->input('email');
$users = DB::select("SELECT * FROM users WHERE email = '$email'");
// Attacker can inject: ' OR '1'='1

// ✅ Good: Parameterized query
$email = $request->input('email');
$users = DB::select('SELECT * FROM users WHERE email = ?', [$email]);

// ✅ Better: Use query builder
$users = DB::table('users')->where('email', $email)->get();

// ✅ Best: Use Eloquent
$users = User::where('email', $email)->get();
```

### Missing Authorization Checks

Always verify authorization before performing actions.

```php
// ❌ Bad: No authorization check
class OrderController extends Controller
{
    public function destroy(Order $order)
    {
        $order->delete();
        return response()->noContent();
    }
}

// ✅ Good: Policy-based authorization
class OrderController extends Controller
{
    public function destroy(Order $order)
    {
        $this->authorize('delete', $order);

        $order->delete();
        return response()->noContent();
    }
}

// OrderPolicy
class OrderPolicy
{
    public function delete(User $user, Order $order): bool
    {
        return $user->id === $order->user_id || $user->isAdmin();
    }
}
```

### Unescaped Output

Always escape user-generated content.

```php
// ❌ Bad: Unescaped output (XSS vulnerability)
<div class="comment">
    {!! $comment->body !!}
</div>

// ✅ Good: Escaped output
<div class="comment">
    {{ $comment->body }}
</div>

// If HTML is needed, sanitize first
<div class="comment">
    {!! clean($comment->body) !!}
</div>
```

## Performance Anti-Patterns

### Loading All Records

Never load all records without pagination.

```php
// ❌ Bad: Loading all records
$users = User::all(); // Could be millions!

foreach ($users as $user) {
    // Process
}

// ✅ Good: Paginate
$users = User::paginate(50);

// ✅ Or use chunking
User::chunk(100, function ($users) {
    foreach ($users as $user) {
        // Process
    }
});

// ✅ Or cursor for memory efficiency
foreach (User::cursor() as $user) {
    // Process one at a time
}
```

### Not Using Query Result Caching

Cache expensive query results.

```php
// ❌ Bad: Running expensive query every time
public function getStatistics()
{
    return Order::with('items')
        ->where('created_at', '>', now()->subYear())
        ->get()
        ->groupBy('status')
        ->map->count();
}

// ✅ Good: Cache the result
public function getStatistics()
{
    return Cache::remember('order-statistics', 3600, function () {
        return Order::with('items')
            ->where('created_at', '>', now()->subYear())
            ->get()
            ->groupBy('status')
            ->map->count();
    });
}
```

## Testing Anti-Patterns

### Testing Implementation Details

Test behavior, not implementation.

```php
// ❌ Bad: Testing implementation
test('order has items array', function () {
    $order = new Order();
    expect($order)->toHaveProperty('items');
    expect($order->items)->toBeArray();
});

// ✅ Good: Testing behavior
test('order calculates total from items', function () {
    $order = Order::create(
        customerId: 'cust-1',
        lineItems: [
            new LineItem('A', 2, Money::USD(1000)),
            new LineItem('B', 1, Money::USD(500)),
        ]
    );

    expect($order->total())->toEqual(Money::USD(2500));
});
```

### Not Using Factories

Use factories for consistent test data.

```php
// ❌ Bad: Creating test data manually
test('user can create order', function () {
    $user = User::create([
        'name' => 'Test User',
        'email' => 'test@example.com',
        'password' => bcrypt('password'),
    ]);

    $product = Product::create([
        'name' => 'Test Product',
        'price' => 1000,
    ]);

    // Test logic...
});

// ✅ Good: Using factories
test('user can create order', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create();

    // Test logic...
});
```

### Testing Multiple Things

One test should verify one behavior.

```php
// ❌ Bad: Testing multiple behaviors
test('order functionality', function () {
    $order = Order::factory()->create();

    expect($order->total())->toBeInt();
    expect($order->canCancel())->toBeTrue();
    expect($order->items)->toHaveCount(1);
    expect($order->status)->toBe('pending');
});

// ✅ Good: Separate tests
test('order calculates total', function () {
    $order = Order::factory()->create();
    expect($order->total())->toEqual(Money::USD(10000));
});

test('pending order can be cancelled', function () {
    $order = Order::factory()->pending()->create();
    expect($order->canCancel())->toBeTrue();
});

test('completed order cannot be cancelled', function () {
    $order = Order::factory()->completed()->create();
    expect($order->canCancel())->toBeFalse();
});
```
