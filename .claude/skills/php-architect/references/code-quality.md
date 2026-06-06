# Clean Code & SOLID Principles

This reference provides comprehensive guidance on Clean Code principles, SOLID design, code smells, and testing philosophy for PHP.

## Table of Contents
- [Naming Conventions](#naming-conventions)
- [Functions and Methods](#functions-and-methods)
- [Classes](#classes)
- [SOLID Principles](#solid-principles)
- [Code Smells to Avoid](#code-smells-to-avoid)
- [Testing Philosophy](#testing-philosophy)

## Naming Conventions

Good names reveal intent and make code self-documenting.

### Classes
- **Noun phrases** that describe what they are
- Examples: `InvoiceGenerator`, `OrderRepository`, `PaymentProcessor`, `EmailAddress`

### Methods
- **Verb phrases** that describe what they do
- Examples: `calculateTotal()`, `sendNotification()`, `processPayment()`, `validate()`

### Variables
- **Reveal intent** rather than using abbreviations
- Good: `$activeSubscriptions`, `$pendingOrders`, `$totalAmount`
- Bad: `$subs`, `$data`, `$temp`, `$arr`

### Booleans
- **Question form** that can be answered yes/no
- Examples: `$isActive`, `$hasPermission`, `$canEdit`, `$shouldNotify`

### Constants
- **UPPER_SNAKE_CASE** for constants
- Examples: `MAX_RETRIES`, `DEFAULT_TIMEOUT`, `API_VERSION`

## Functions and Methods

Well-designed methods are the foundation of clean code.

### Key Principles

1. **Single level of abstraction per function**
   - Don't mix high-level operations with low-level details
   - Keep all code in a function at the same conceptual level

2. **Maximum 3-4 parameters** (use DTOs for more)
   ```php
   // ❌ Bad: Too many parameters
   public function createOrder(
       string $customerId,
       string $productId,
       int $quantity,
       int $price,
       float $tax,
       int $shipping
   ): Order

   // ✅ Good: Use DTO
   public function createOrder(CreateOrderDTO $dto): Order
   ```

3. **No flag arguments** — split into separate methods
   ```php
   // ❌ Bad: Flag argument
   public function render(bool $includeHeaders = false): string

   // ✅ Good: Separate methods
   public function render(): string
   public function renderWithHeaders(): string
   ```

4. **Command-Query Separation**
   - Methods either change state OR return data, never both
   ```php
   // ❌ Bad: Does both
   public function markAsProcessed(): bool
   {
       $this->status = Status::Processed;
       return true;
   }

   // ✅ Good: Separate concerns
   public function markAsProcessed(): void
   {
       $this->status = Status::Processed;
   }

   public function isProcessed(): bool
   {
       return $this->status === Status::Processed;
   }
   ```

## Classes

Classes should be small, focused, and cohesive.

### Design Guidelines

1. **Small, focused classes** (under 200 lines is a good target)
2. **High cohesion**: all methods should use most instance variables
3. **Dependency injection** over service location
4. **Prefer composition** over inheritance
5. **Final by default** unless explicitly designed for extension

### Class Template

```php
<?php

declare(strict_types=1);

namespace App\Domain\Module;

final readonly class ClassName
{
    public function __construct(
        private DependencyInterface $dependency,
    ) {}

    public function methodName(Parameter $param): ReturnType
    {
        // Implementation
    }
}
```

## SOLID Principles

### Single Responsibility Principle (SRP)

A class should have only one reason to change.

```php
// ❌ Bad: Class doing too much
class UserService
{
    public function register(array $data): User { }
    public function sendWelcomeEmail(User $user): void { }
    public function generateReport(User $user): Report { }
    public function exportToCsv(User $user): string { }
}

// ✅ Good: Separate concerns
final readonly class RegisterUserService
{
    public function execute(RegisterUserDTO $dto): User { }
}

final readonly class SendWelcomeEmailService
{
    public function execute(User $user): void { }
}

final readonly class UserReportGenerator
{
    public function generate(User $user): Report { }
}
```

### Open/Closed Principle (OCP)

Software entities should be open for extension but closed for modification.

```php
// ✅ Good: Extensible through strategy
interface PaymentStrategy
{
    public function process(Money $amount): PaymentResult;
}

final readonly class CreditCardPayment implements PaymentStrategy
{
    public function process(Money $amount): PaymentResult
    {
        // Credit card processing
    }
}

final readonly class PayPalPayment implements PaymentStrategy
{
    public function process(Money $amount): PaymentResult
    {
        // PayPal processing
    }
}

final readonly class PaymentProcessor
{
    public function __construct(
        private PaymentStrategy $strategy,
    ) {}

    public function execute(Money $amount): PaymentResult
    {
        return $this->strategy->process($amount);
    }
}
```

### Liskov Substitution Principle (LSP)

Subtypes must be substitutable for their base types.

- Avoid throwing unexpected exceptions in derived classes
- Maintain behavioral compatibility
- Don't strengthen preconditions or weaken postconditions

```php
// ✅ Good: Subtypes are substitutable
interface Shape
{
    public function area(): float;
}

final readonly class Rectangle implements Shape
{
    public function __construct(
        private float $width,
        private float $height,
    ) {}

    public function area(): float
    {
        return $this->width * $this->height;
    }
}

final readonly class Circle implements Shape
{
    public function __construct(
        private float $radius,
    ) {}

    public function area(): float
    {
        return pi() * $this->radius ** 2;
    }
}
```

### Interface Segregation Principle (ISP)

Clients should not be forced to depend on interfaces they don't use.

```php
// ❌ Bad: Fat interface
interface UserRepositoryInterface
{
    public function find(string $id): ?User;
    public function save(User $user): void;
    public function generateReport(): Report;
    public function sendNotification(User $user): void;
}

// ✅ Good: Segregated interfaces
interface ReadableUserRepositoryInterface
{
    public function find(string $id): ?User;
}

interface WritableUserRepositoryInterface
{
    public function save(User $user): void;
}

interface UserReportingInterface
{
    public function generateReport(): Report;
}
```

### Dependency Inversion Principle (DIP)

High-level modules should not depend on low-level modules. Both should depend on abstractions.

```php
// ✅ Good: Depend on abstractions
final readonly class OrderService
{
    public function __construct(
        private OrderRepositoryInterface $repository,      // Abstraction
        private PaymentGatewayInterface $gateway,          // Abstraction
        private NotificationServiceInterface $notifications, // Abstraction
    ) {}
}

// Infrastructure implements the interfaces
final readonly class MySQLOrderRepository implements OrderRepositoryInterface
{
    // Implementation
}

final readonly class StripePaymentGateway implements PaymentGatewayInterface
{
    // Implementation
}
```

## Code Smells to Avoid

Actively identify and refactor these common code smells:

### Long Methods
- **Smell**: Methods longer than 20-30 lines
- **Fix**: Extract smaller, well-named methods

```php
// ❌ Bad: Long method
public function processOrder(array $data): Order
{
    // 100 lines of code doing validation, calculation, persistence, notification...
}

// ✅ Good: Extracted methods
public function processOrder(CreateOrderDTO $dto): Order
{
    $this->validateOrder($dto);
    $order = $this->createOrder($dto);
    $this->persistOrder($order);
    $this->notifyCustomer($order);
    return $order;
}
```

### Large Classes
- **Smell**: Classes with too many responsibilities (over 200 lines)
- **Fix**: Extract collaborators, split into focused classes

### Feature Envy
- **Smell**: Method uses data from another class more than its own
- **Fix**: Move the method to where the data lives

```php
// ❌ Bad: Feature envy
class OrderService
{
    public function calculateDiscount(Order $order): Money
    {
        $total = $order->getTotal();
        $items = $order->getItems();
        $customer = $order->getCustomer();
        // Using order's data more than own
    }
}

// ✅ Good: Move to Order
class Order
{
    public function calculateDiscount(): Money
    {
        // Has direct access to own data
    }
}
```

### Primitive Obsession
- **Smell**: Using primitives instead of domain concepts
- **Fix**: Create Value Objects

```php
// ❌ Bad: Primitive obsession
public function setPrice(int $cents): void
{
    $this->priceCents = $cents;
}

// ✅ Good: Value object
public function setPrice(Money $price): void
{
    $this->price = $price;
}
```

### Shotgun Surgery
- **Smell**: Every change requires modifications in many classes
- **Fix**: Consolidate related changes into one place

### Divergent Change
- **Smell**: Class changes for multiple different reasons
- **Fix**: Separate concerns into different classes

## Testing Philosophy

Write tests that provide confidence and enable refactoring. Use **Pest** or **PHPUnit**.

### Test Pyramid

1. **Unit Tests**: Domain logic, Value Objects, Entities
   - Fast, isolated
   - Test business rules

2. **Integration Tests**: Repositories, External services
   - Use test doubles for external dependencies
   - Test integration points

3. **Feature Tests**: HTTP endpoints, CLI commands
   - End-to-end behavior
   - Test user-facing functionality

### Pest Testing Framework

Pest provides a clean, expressive syntax for PHP testing.

#### Unit Test Example

```php
use App\Domain\Orders\Entity\Order;
use App\Domain\Orders\ValueObject\Money;
use App\Domain\Orders\ValueObject\LineItem;

test('order calculates total from line items', function () {
    // Arrange
    $lineItems = [
        new LineItem('product-1', quantity: 2, price: Money::fromCents(1000, 'USD')),
        new LineItem('product-2', quantity: 1, price: Money::fromCents(500, 'USD')),
    ];

    // Act
    $order = Order::create(customerId: 'cust-1', lineItems: $lineItems);

    // Assert
    expect($order->total())->toEqual(Money::fromCents(2500, 'USD'));
});

it('validates minimum quantity', function () {
    expect(fn() => new LineItem('product-1', quantity: 0, price: Money::fromCents(1000, 'USD')))
        ->toThrow(InvalidArgumentException::class);
});
```

#### Integration Test Example

```php
test('repository saves and retrieves order', function () {
    $repository = new MySQLOrderRepository($pdo);

    $order = Order::create(
        customerId: 'cust-1',
        lineItems: [/* ... */]
    );

    $repository->save($order);

    $retrieved = $repository->find($order->id());

    expect($retrieved)->not->toBeNull()
        ->and($retrieved->id())->toEqual($order->id())
        ->and($retrieved->customerId())->toEqual($order->customerId());
});
```

### PHPUnit Testing Framework

Traditional PHPUnit tests are also fully supported.

```php
use PHPUnit\Framework\TestCase;

final class OrderTest extends TestCase
{
    public function testOrderCalculatesTotalFromLineItems(): void
    {
        // Arrange
        $lineItems = [
            new LineItem('product-1', 2, Money::fromCents(1000, 'USD')),
            new LineItem('product-2', 1, Money::fromCents(500, 'USD')),
        ];

        // Act
        $order = Order::create('cust-1', $lineItems);

        // Assert
        $this->assertEquals(
            Money::fromCents(2500, 'USD'),
            $order->total()
        );
    }
}
```

### Testing Patterns

Use the **Arrange-Act-Assert** pattern:

```php
test('order applies discount correctly', function () {
    // Arrange
    $order = Order::create(
        customerId: 'cust-1',
        lineItems: [new LineItem('p1', 1, Money::fromCents(10000, 'USD'))]
    );

    // Act
    $discountedOrder = $order->applyDiscount(Percentage::fromFloat(0.1));

    // Assert
    expect($discountedOrder->total())->toEqual(Money::fromCents(9000, 'USD'));
});
```

### What to Test

- **Business rules and domain logic** (always)
- **Edge cases and boundaries** (always)
- **Error conditions** (always)
- **Integration points** (with appropriate test doubles)

### Test Naming

Use descriptive test names that explain the scenario:

```php
// Pest style
test('order total includes all line items')
test('payment fails when card is declined')
test('user cannot access order from different customer')

// PHPUnit style
public function testOrderTotalIncludesAllLineItems(): void
public function testPaymentFailsWhenCardIsDeclined(): void
public function testUserCannotAccessOrderFromDifferentCustomer(): void
```

### Test Data Factories

Use factories for consistent test data:

```php
final class OrderFactory
{
    public static function create(array $overrides = []): Order
    {
        $defaults = [
            'customerId' => 'cust-123',
            'lineItems' => [
                new LineItem('p1', 1, Money::fromCents(1000, 'USD')),
            ],
        ];

        $data = array_merge($defaults, $overrides);

        return Order::create($data['customerId'], $data['lineItems']);
    }

    public static function pending(): Order
    {
        return self::create(['status' => OrderStatus::Pending]);
    }

    public static function completed(): Order
    {
        return self::create(['status' => OrderStatus::Completed]);
    }
}

// Usage
test('pending order can be cancelled', function () {
    $order = OrderFactory::pending();
    expect($order->canCancel())->toBeTrue();
});
```
