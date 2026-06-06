# Clean Code & SOLID Principles

This reference provides comprehensive guidance on Clean Code principles, SOLID design, code smells, and testing philosophy.

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
- Examples: `InvoiceGenerator`, `OrderRepository`, `PaymentProcessor`

### Methods
- **Verb phrases** that describe what they do
- Examples: `calculateTotal()`, `sendNotification()`, `processPayment()`

### Variables
- **Reveal intent** rather than using abbreviations
- Good: `$activeSubscriptions`, `$pendingOrders`, `$totalAmount`
- Bad: `$subs`, `$data`, `$temp`

### Booleans
- **Question form** that can be answered yes/no
- Examples: `$isActive`, `$hasPermission`, `$canEdit`, `$shouldNotify`

## Functions and Methods

Well-designed methods are the foundation of clean code.

### Key Principles

1. **Single level of abstraction per function**
   - Don't mix high-level operations with low-level details
   - Keep all code in a function at the same conceptual level

2. **Maximum 3-4 parameters** (use DTOs for more)
   ```php
   // ❌ Bad: Too many parameters
   public function createOrder($customerId, $productId, $quantity, $price, $tax, $shipping)

   // ✅ Good: Use DTO
   public function createOrder(CreateOrderDTO $dto)
   ```

3. **No flag arguments** — split into separate methods
   ```php
   // ❌ Bad: Flag argument
   public function render($includeHeaders = false)

   // ✅ Good: Separate methods
   public function render()
   public function renderWithHeaders()
   ```

4. **Command-Query Separation**
   - Methods either change state OR return data, never both
   ```php
   // ❌ Bad: Does both
   public function markAsProcessed(): bool

   // ✅ Good: Separate concerns
   public function markAsProcessed(): void
   public function isProcessed(): bool
   ```

## Classes

Classes should be small, focused, and cohesive.

### Design Guidelines

1. **Small, focused classes** (under 200 lines is a good target)
2. **High cohesion**: all methods should use most instance variables
3. **Dependency injection** over service location
4. **Prefer composition** over inheritance

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

    public function methodName(): ReturnType
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
class UserService {
    public function register() { }
    public function sendWelcomeEmail() { }
    public function generateReport() { }
}

// ✅ Good: Separate concerns
class RegisterUserAction { }
class SendWelcomeEmailAction { }
class UserReportGenerator { }
```

### Open/Closed Principle (OCP)

Software entities should be open for extension but closed for modification.

- Design for extension through abstractions
- Use Strategy pattern for varying algorithms
- Leverage Laravel's pipeline pattern for extensible processing

```php
// ✅ Good: Extensible through strategy
interface PaymentStrategy
{
    public function process(Money $amount): PaymentResult;
}

class CreditCardPayment implements PaymentStrategy { }
class PayPalPayment implements PaymentStrategy { }

class PaymentProcessor
{
    public function __construct(
        private PaymentStrategy $strategy,
    ) {}
}
```

### Liskov Substitution Principle (LSP)

Subtypes must be substitutable for their base types.

- Avoid throwing unexpected exceptions in derived classes
- Maintain behavioral compatibility
- Don't strengthen preconditions or weaken postconditions

### Interface Segregation Principle (ISP)

Clients should not be forced to depend on interfaces they don't use.

```php
// ❌ Bad: Fat interface
interface UserRepositoryInterface {
    public function find($id);
    public function save(User $user);
    public function generateReport();
    public function sendNotification();
}

// ✅ Good: Segregated interfaces
interface ReadableRepository {
    public function find($id);
}

interface WritableRepository {
    public function save($entity);
}

interface ReportableRepository {
    public function generateReport();
}
```

### Dependency Inversion Principle (DIP)

High-level modules should not depend on low-level modules. Both should depend on abstractions.

```php
// ✅ Good: Depend on abstractions
class OrderService
{
    public function __construct(
        private OrderRepositoryInterface $repository,
        private PaymentGatewayInterface $gateway,
        private NotificationServiceInterface $notifications,
    ) {}
}

// Infrastructure implements the interfaces
class EloquentOrderRepository implements OrderRepositoryInterface { }
class StripePaymentGateway implements PaymentGatewayInterface { }
```

## Code Smells to Avoid

Actively identify and refactor these common code smells:

### Long Methods
- **Smell**: Methods longer than 20-30 lines
- **Fix**: Extract smaller, well-named methods

### Large Classes
- **Smell**: Classes with too many responsibilities
- **Fix**: Extract collaborators, split into focused classes

### Feature Envy
- **Smell**: Method uses data from another class more than its own
- **Fix**: Move the method to where the data lives

### Primitive Obsession
- **Smell**: Using primitives instead of domain concepts
- **Fix**: Create Value Objects
```php
// ❌ Bad: Primitive obsession
public function setPrice(int $cents) { }

// ✅ Good: Value object
public function setPrice(Money $price) { }
```

### Shotgun Surgery
- **Smell**: Every change requires modifications in many classes
- **Fix**: Consolidate related changes into one place

### Divergent Change
- **Smell**: Class changes for multiple different reasons
- **Fix**: Separate concerns into different classes

## Testing Philosophy

Write tests that provide confidence and enable refactoring. **Always use Pest** for testing.

### Test Pyramid

1. **Unit Tests**: Domain logic, Value Objects, Entities
   - Fast, isolated
   - Test business rules

2. **Integration Tests**: Repositories, External services
   - Use test doubles for external dependencies
   - Test integration points

3. **Feature Tests**: HTTP endpoints
   - Full request/response cycles
   - Test user-facing behavior

### Pest Testing Framework

Always use Pest for all tests. Pest provides a clean, expressive syntax for testing.

#### Unit Test Example (Pest)

```php
use App\Domain\Orders\Entities\Order;
use App\Domain\Orders\ValueObjects\LineItem;
use App\Domain\Orders\ValueObjects\Money;

test('order calculates total correctly', function () {
    // Arrange
    $lineItems = [
        new LineItem(productId: 'A', quantity: 2, unitPrice: Money::USD(1000)),
        new LineItem(productId: 'B', quantity: 1, unitPrice: Money::USD(500)),
    ];

    // Act
    $order = Order::create(customerId: 'cust-1', lineItems: $lineItems);

    // Assert
    expect($order->total())->toEqual(Money::USD(2500));
});
```

#### Feature Test Example (Pest)

```php
use App\Infrastructure\Orders\Models\Order;

test('user can create order', function () {
    $response = $this->postJson('/api/orders', [
        'customer_id' => 'cust-1',
        'line_items' => [
            ['product_id' => 'A', 'quantity' => 2, 'unit_price' => 1000],
        ],
    ]);

    $response->assertStatus(201)
        ->assertJsonStructure(['id', 'customer_id', 'total']);

    expect(Order::count())->toBe(1);
});
```

#### Integration Test Example (Pest)

```php
use App\Domain\Orders\Entities\Order;
use App\Infrastructure\Orders\Repositories\EloquentOrderRepository;

test('repository saves and retrieves order', function () {
    $repository = app(EloquentOrderRepository::class);

    $order = Order::create(
        customerId: 'cust-1',
        lineItems: [/* ... */]
    );

    $repository->save($order);

    $retrieved = $repository->find($order->id);

    expect($retrieved)->not->toBeNull()
        ->and($retrieved->id)->toBe($order->id)
        ->and($retrieved->customerId)->toBe($order->customerId);
});
```

### Pest Best Practices

1. **Use descriptive test names** (no need for `test_` prefix)
   ```php
   test('order total includes all line items')
   test('payment fails when card is declined')
   test('user cannot access order from different customer')
   ```

2. **Use `it()` for more natural language**
   ```php
   it('calculates order total correctly')
   it('fails when card is declined')
   it('prevents access to other customer orders')
   ```

3. **Use higher-order tests** for cleaner code
   ```php
   it('has required fields', function () {
       expect($this->order)
           ->toHaveProperty('id')
           ->toHaveProperty('customerId')
           ->toHaveProperty('total');
   });
   ```

4. **Group related tests with `describe()`**
   ```php
   describe('Order', function () {
       test('calculates total')
       test('applies discount')
       test('validates minimum amount')
   });
   ```

5. **Use datasets for testing multiple scenarios**
   ```php
   test('validates email format', function ($email, $isValid) {
       $result = EmailAddress::isValid($email);
       expect($result)->toBe($isValid);
   })->with([
       ['test@example.com', true],
       ['invalid-email', false],
       ['@example.com', false],
   ]);
   ```

### What to Test

- **Business rules and domain logic** (always)
- **Edge cases and boundaries** (always)
- **Error conditions** (always)
- **Integration points** (with appropriate test doubles)

### Pest Expectations

Use Pest's fluent expectations:

```php
// Equality
expect($value)->toBe(10);
expect($value)->toEqual($expected);

// Types
expect($value)->toBeString();
expect($value)->toBeInt();
expect($value)->toBeInstanceOf(Order::class);

// Truthiness
expect($value)->toBeTrue();
expect($value)->toBeFalse();
expect($value)->toBeNull();

// Collections
expect($array)->toHaveCount(3);
expect($array)->toContain('value');

// Exceptions
expect(fn() => $action->execute())
    ->toThrow(InvalidArgumentException::class);
```
