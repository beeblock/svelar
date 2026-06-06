# Refactoring Suggestion Templates

Use these templates to provide detailed refactoring guidance.

## Extract to Action Class

### Problem
Controller contains business logic, violating Single Responsibility Principle.

### Current Code
```php
class OrderController extends Controller
{
    public function store(Request $request)
    {
        $validated = $request->validate([...]);

        // Business logic in controller
        $total = 0;
        foreach ($validated['items'] as $item) {
            $product = Product::find($item['id']);
            $total += $product->price * $item['quantity'];
        }

        $order = Order::create([
            'user_id' => auth()->id(),
            'total' => $total,
        ]);

        event(new OrderCreated($order));

        return response()->json($order, 201);
    }
}
```

### Refactored Solution

**Step 1: Create DTO**
```php
// app/Domain/Orders/DTOs/CreateOrderDTO.php
namespace App\Domain\Orders\DTOs;

final readonly class CreateOrderDTO
{
    public function __construct(
        public string $customerId,
        public array $lineItems,
    ) {}

    public static function fromRequest(CreateOrderRequest $request): self
    {
        return new self(
            customerId: $request->user()->id,
            lineItems: $request->validated('items'),
        );
    }
}
```

**Step 2: Create Action**
```php
// app/Domain/Orders/Actions/CreateOrderAction.php
namespace App\Domain\Orders\Actions;

final readonly class CreateOrderAction
{
    public function __construct(
        private OrderRepositoryInterface $repository,
    ) {}

    public function execute(CreateOrderDTO $dto): Order
    {
        $order = Order::create(
            customerId: $dto->customerId,
            lineItems: $this->buildLineItems($dto->lineItems),
        );

        $this->repository->save($order);

        event(new OrderWasCreated($order->id, $order->customerId));

        return $order;
    }

    private function buildLineItems(array $items): array
    {
        return array_map(
            fn($item) => new LineItem(
                productId: $item['product_id'],
                quantity: $item['quantity'],
            ),
            $items
        );
    }
}
```

**Step 3: Simplify Controller**
```php
class OrderController extends Controller
{
    public function store(
        CreateOrderRequest $request,
        CreateOrderAction $action
    ): JsonResponse {
        $dto = CreateOrderDTO::fromRequest($request);
        $order = $action->execute($dto);

        return response()->json(
            new OrderResource($order),
            201
        );
    }
}
```

### Benefits
- Controller is now thin and focused on HTTP concerns
- Business logic is testable in isolation
- Action class follows Single Responsibility Principle
- DTO provides type-safe data transfer
- Easy to reuse action from other contexts (jobs, commands)

---

## Introduce Value Object

### Problem
Using primitives for domain concepts (primitive obsession).

### Current Code
```php
class Order
{
    public function __construct(
        private int $amountCents,
        private string $currency,
    ) {}

    public function total(): int
    {
        return $this->amountCents;
    }

    public function addTax(float $rate): void
    {
        $this->amountCents += (int)($this->amountCents * $rate);
    }
}

// Usage
$order = new Order(10000, 'USD');
$order->addTax(0.1);
echo $order->total(); // 11000 cents in USD?
```

### Refactored Solution

**Create Value Object**
```php
// app/Domain/Shared/ValueObjects/Money.php
namespace App\Domain\Shared\ValueObjects;

final readonly class Money
{
    private function __construct(
        public int $cents,
        public Currency $currency,
    ) {
        if ($cents < 0) {
            throw new InvalidArgumentException('Money cannot be negative');
        }
    }

    public static function USD(int $cents): self
    {
        return new self($cents, Currency::USD);
    }

    public static function EUR(int $cents): self
    {
        return new self($cents, Currency::EUR);
    }

    public function add(self $other): self
    {
        $this->assertSameCurrency($other);
        return new self($this->cents + $other->cents, $this->currency);
    }

    public function multiply(float $multiplier): self
    {
        return new self(
            (int)round($this->cents * $multiplier),
            $this->currency
        );
    }

    public function addTax(float $rate): self
    {
        return $this->add($this->multiply($rate));
    }

    public function equals(self $other): bool
    {
        return $this->cents === $other->cents
            && $this->currency === $other->currency;
    }

    private function assertSameCurrency(self $other): void
    {
        if ($this->currency !== $other->currency) {
            throw new InvalidArgumentException('Currency mismatch');
        }
    }
}

enum Currency: string
{
    case USD = 'USD';
    case EUR = 'EUR';
    case GBP = 'GBP';
}
```

**Updated Domain Code**
```php
class Order
{
    public function __construct(
        private Money $total,
    ) {}

    public function total(): Money
    {
        return $this->total;
    }

    public function withTax(float $rate): self
    {
        return new self(
            total: $this->total->addTax($rate),
        );
    }
}

// Usage - much clearer!
$order = new Order(Money::USD(10000));
$orderWithTax = $order->withTax(0.1);
echo $orderWithTax->total()->cents; // 11000
```

### Benefits
- Type-safe - can't mix currencies
- Self-documenting - Money::USD(10000) is clear
- Validation centralized in value object
- Operations (add, multiply) encapsulated
- Immutable - prevents bugs from unexpected mutations

---

## Extract Repository Interface

### Problem
Domain logic directly using Eloquent models (tight coupling).

### Current Code
```php
// app/Domain/Orders/Actions/GetOrderAction.php
namespace App\Domain\Orders\Actions;

use App\Infrastructure\Orders\Models\OrderModel; // Tight coupling!

class GetOrderAction
{
    public function execute(string $orderId): ?array
    {
        $model = OrderModel::with('items')->find($orderId);

        if (!$model) {
            return null;
        }

        return [
            'id' => $model->id,
            'total' => $model->total,
            // ... mapping logic
        ];
    }
}
```

### Refactored Solution

**Step 1: Define Repository Interface in Domain**
```php
// app/Domain/Orders/Repositories/OrderRepositoryInterface.php
namespace App\Domain\Orders\Repositories;

use App\Domain\Orders\Entities\Order;

interface OrderRepositoryInterface
{
    public function find(string $id): ?Order;
    public function save(Order $order): void;
    public function findByCustomer(string $customerId): array;
}
```

**Step 2: Create Domain Entity**
```php
// app/Domain/Orders/Entities/Order.php
namespace App\Domain\Orders\Entities;

final class Order
{
    public function __construct(
        public readonly string $id,
        public readonly string $customerId,
        private array $items,
        private Money $total,
    ) {}

    public function total(): Money
    {
        return $this->total;
    }

    // Business logic here
}
```

**Step 3: Implement Repository in Infrastructure**
```php
// app/Infrastructure/Orders/Repositories/EloquentOrderRepository.php
namespace App\Infrastructure\Orders\Repositories;

use App\Domain\Orders\Entities\Order;
use App\Domain\Orders\Repositories\OrderRepositoryInterface;
use App\Infrastructure\Orders\Models\OrderModel;

final class EloquentOrderRepository implements OrderRepositoryInterface
{
    public function find(string $id): ?Order
    {
        $model = OrderModel::with('items')->find($id);

        return $model ? $this->toDomainEntity($model) : null;
    }

    public function save(Order $order): void
    {
        OrderModel::updateOrCreate(
            ['id' => $order->id],
            $this->toArray($order)
        );
    }

    private function toDomainEntity(OrderModel $model): Order
    {
        return new Order(
            id: $model->id,
            customerId: $model->customer_id,
            items: $model->items->map(fn($i) => /* map to domain */)->all(),
            total: Money::USD($model->total_cents),
        );
    }

    private function toArray(Order $order): array
    {
        return [
            'id' => $order->id,
            'customer_id' => $order->customerId,
            'total_cents' => $order->total()->cents,
        ];
    }
}
```

**Step 4: Update Action**
```php
// app/Domain/Orders/Actions/GetOrderAction.php
namespace App\Domain\Orders\Actions;

use App\Domain\Orders\Repositories\OrderRepositoryInterface;

final readonly class GetOrderAction
{
    public function __construct(
        private OrderRepositoryInterface $repository,
    ) {}

    public function execute(string $orderId): ?Order
    {
        return $this->repository->find($orderId);
    }
}
```

**Step 5: Bind in Service Provider**
```php
// app/Infrastructure/Orders/Providers/OrderServiceProvider.php
public function register(): void
{
    $this->app->bind(
        OrderRepositoryInterface::class,
        EloquentOrderRepository::class
    );
}
```

### Benefits
- Domain decoupled from Eloquent
- Easy to test with fake repository
- Can swap persistence layer without changing domain
- Clear boundary between domain and infrastructure
- Follows Dependency Inversion Principle

---

## Improve Test Quality

### Problem
Tests are unclear, test multiple things, and hard to maintain.

### Current Code
```php
test('order functionality', function () {
    $order = Order::factory()->create([
        'total' => 10000,
        'status' => 'pending',
    ]);

    expect($order->total)->toBe(10000);
    expect($order->status)->toBe('pending');
    expect($order->canCancel())->toBeTrue();

    $order->cancel();

    expect($order->status)->toBe('cancelled');
    expect($order->canRefund())->toBeTrue();
});
```

### Refactored Solution

```php
// Test one behavior per test
test('order calculates total from line items', function () {
    $order = Order::create(
        customerId: 'cust-1',
        lineItems: [
            new LineItem('product-1', quantity: 2, price: Money::USD(1000)),
            new LineItem('product-2', quantity: 1, price: Money::USD(500)),
        ]
    );

    expect($order->total())->toEqual(Money::USD(2500));
});

test('new order has pending status', function () {
    $order = Order::factory()->create();

    expect($order->status)->toBe(OrderStatus::Pending);
});

test('pending order can be cancelled', function () {
    $order = Order::factory()->pending()->create();

    expect($order->canCancel())->toBeTrue();
});

test('completed order cannot be cancelled', function () {
    $order = Order::factory()->completed()->create();

    expect($order->canCancel())->toBeFalse();
});

test('cancelling order changes status to cancelled', function () {
    $order = Order::factory()->pending()->create();

    $order->cancel();

    expect($order->status)->toBe(OrderStatus::Cancelled);
});

test('cancelled order can be refunded', function () {
    $order = Order::factory()->cancelled()->create();

    expect($order->canRefund())->toBeTrue();
});
```

### Benefits
- Each test has clear, specific name
- Easy to identify what failed
- Tests can run independently
- Easier to maintain and modify
- Better documentation of behavior
