# Architecture Patterns

This reference provides detailed guidance on Domain-Driven Design, Event-Driven Architecture, CQRS, and Hexagonal Architecture for PHP applications.

## Table of Contents
- [Domain-Driven Design (DDD)](#domain-driven-design-ddd)
- [Bounded Contexts](#bounded-contexts)
- [Event-Driven Architecture](#event-driven-architecture)
- [CQRS Pattern](#cqrs-pattern)
- [Hexagonal Architecture](#hexagonal-architecture)
- [Repository Pattern](#repository-pattern)

## Domain-Driven Design (DDD)

DDD is a software design approach focused on modeling software to match the business domain.

### Core Concepts

**Entities**: Objects with unique identity that persist over time
```php
final class Order
{
    public function __construct(
        private readonly OrderId $id,
        private CustomerId $customerId,
        private array $lineItems,
        private OrderStatus $status,
    ) {}

    public function id(): OrderId
    {
        return $this->id;
    }

    public function complete(): void
    {
        if ($this->status !== OrderStatus::Pending) {
            throw new InvalidOrderStateException();
        }

        $this->status = OrderStatus::Completed;
    }
}
```

**Value Objects**: Immutable objects identified by their values, not identity
```php
final readonly class Money
{
    public function __construct(
        public int $amount,
        public Currency $currency,
    ) {
        if ($amount < 0) {
            throw new InvalidArgumentException('Amount cannot be negative');
        }
    }

    public function add(self $other): self
    {
        $this->assertSameCurrency($other);
        return new self($this->amount + $other->amount, $this->currency);
    }

    public function equals(self $other): bool
    {
        return $this->amount === $other->amount
            && $this->currency === $other->currency;
    }

    private function assertSameCurrency(self $other): void
    {
        if ($this->currency !== $other->currency) {
            throw new CurrencyMismatchException();
        }
    }
}
```

**Aggregates**: Clusters of entities and value objects with a root entity
```php
final class Order // Aggregate Root
{
    private array $lineItems = []; // Part of aggregate

    public function addLineItem(LineItem $item): void
    {
        // Aggregate enforces business rules
        if (count($this->lineItems) >= 100) {
            throw new MaxLineItemsExceededException();
        }

        $this->lineItems[] = $item;
    }

    public function total(): Money
    {
        return array_reduce(
            $this->lineItems,
            fn(Money $sum, LineItem $item) => $sum->add($item->subtotal()),
            Money::zero($this->currency)
        );
    }
}
```

**Domain Services**: Operations that don't naturally belong to an entity or value object
```php
final readonly class PricingService
{
    public function __construct(
        private DiscountPolicyInterface $discountPolicy,
        private TaxCalculatorInterface $taxCalculator,
    ) {}

    public function calculateFinalPrice(Order $order): Money
    {
        $subtotal = $order->total();
        $discount = $this->discountPolicy->calculateDiscount($order);
        $afterDiscount = $subtotal->subtract($discount);
        $tax = $this->taxCalculator->calculateTax($afterDiscount);

        return $afterDiscount->add($tax);
    }
}
```

## Bounded Contexts

Divide large domains into bounded contexts with clear boundaries.

### Context Mapping

```
src/
├── Domain/
│   ├── Sales/              # Sales Context
│   │   ├── Entity/
│   │   │   └── Order.php
│   │   └── Repository/
│   │       └── OrderRepositoryInterface.php
│   │
│   ├── Inventory/          # Inventory Context
│   │   ├── Entity/
│   │   │   └── Product.php
│   │   └── Repository/
│   │       └── ProductRepositoryInterface.php
│   │
│   └── Billing/            # Billing Context
│       ├── Entity/
│       │   └── Invoice.php
│       └── Service/
│           └── PaymentService.php
```

### Context Integration

Contexts communicate through well-defined interfaces:

```php
// Sales Context
namespace App\Domain\Sales\Service;

use App\Domain\Billing\Contract\BillingServiceInterface;

final readonly class OrderCompletionService
{
    public function __construct(
        private BillingServiceInterface $billingService, // Interface from Billing context
    ) {}

    public function completeOrder(Order $order): void
    {
        $order->complete();

        // Call billing context through interface
        $this->billingService->createInvoice(
            customerId: $order->customerId(),
            amount: $order->total(),
        );
    }
}
```

## Event-Driven Architecture

Events represent things that have happened in the domain.

### Domain Events

Domain events are immutable records of facts:

```php
final readonly class OrderWasPlaced
{
    public function __construct(
        public string $orderId,
        public string $customerId,
        public Money $total,
        public DateTimeImmutable $occurredAt,
    ) {}
}
```

### Event Dispatcher

```php
interface EventDispatcherInterface
{
    public function dispatch(object $event): void;
    public function subscribe(string $eventClass, callable $handler): void;
}
```

### Event Handlers

```php
final readonly class SendOrderConfirmationEmail
{
    public function __construct(
        private MailerInterface $mailer,
        private OrderRepositoryInterface $orderRepository,
    ) {}

    public function __invoke(OrderWasPlaced $event): void
    {
        $order = $this->orderRepository->find($event->orderId);

        $this->mailer->send(
            to: $order->customerEmail(),
            subject: 'Order Confirmation',
            template: 'order-confirmation',
            data: ['order' => $order],
        );
    }
}
```

### Event Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Command   │────▶│   Domain    │────▶│   Event     │
│   Handler   │     │   Logic     │     │  Dispatch   │
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         ▼                         ▼
            ┌─────────────┐           ┌─────────────┐           ┌─────────────┐
            │   Handler   │           │   Handler   │           │   Handler   │
            │  (Sync)     │           │  (Async)    │           │  (Async)    │
            └─────────────┘           └─────────────┘           └─────────────┘
```

## CQRS Pattern

Command Query Responsibility Segregation separates reads from writes.

### Commands (Write Operations)

```php
// Command
final readonly class CreateOrderCommand
{
    public function __construct(
        public string $customerId,
        public array $lineItems,
    ) {}
}

// Command Handler
final readonly class CreateOrderCommandHandler
{
    public function __construct(
        private OrderRepositoryInterface $repository,
        private EventDispatcherInterface $eventDispatcher,
    ) {}

    public function handle(CreateOrderCommand $command): string
    {
        $order = Order::create(
            customerId: new CustomerId($command->customerId),
            lineItems: $command->lineItems,
        );

        $this->repository->save($order);

        $this->eventDispatcher->dispatch(
            new OrderWasCreated($order->id()->value(), $order->customerId()->value())
        );

        return $order->id()->value();
    }
}
```

### Queries (Read Operations)

```php
// Query
final readonly class GetOrderByIdQuery
{
    public function __construct(
        public string $orderId,
    ) {}
}

// Query Handler
final readonly class GetOrderByIdQueryHandler
{
    public function __construct(
        private PDO $readDatabase, // Separate read database
    ) {}

    public function handle(GetOrderByIdQuery $query): ?array
    {
        $stmt = $this->readDatabase->prepare(
            'SELECT * FROM orders_view WHERE id = :id'
        );
        $stmt->execute(['id' => $query->orderId]);

        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        return $result ?: null;
    }
}
```

### CQRS Benefits

- **Scalability**: Read and write models can scale independently
- **Optimization**: Queries optimized for reads, commands for writes
- **Complexity**: Separates complex write logic from simple reads
- **Evolution**: Models can evolve independently

## Hexagonal Architecture

Also known as Ports and Adapters pattern.

### Structure

```
Domain (Core)
    ├── Ports (Interfaces)
    │   ├── OrderRepositoryInterface (driven port)
    │   ├── PaymentGatewayInterface (driven port)
    │   └── OrderServiceInterface (driving port)
    │
Infrastructure (Adapters)
    ├── Persistence/
    │   └── MySQLOrderRepository (implements OrderRepositoryInterface)
    ├── Payment/
    │   └── StripePaymentGateway (implements PaymentGatewayInterface)
    └── Http/
        └── OrderController (uses OrderServiceInterface)
```

### Ports (Interfaces)

```php
// Driven Port (called by domain)
namespace App\Domain\Orders\Repository;

interface OrderRepositoryInterface
{
    public function find(OrderId $id): ?Order;
    public function save(Order $order): void;
}

// Driving Port (calls into domain)
namespace App\Domain\Orders\Service;

interface OrderServiceInterface
{
    public function createOrder(CreateOrderDTO $dto): Order;
    public function cancelOrder(OrderId $id): void;
}
```

### Adapters (Implementations)

```php
// Infrastructure Adapter (implements driven port)
namespace App\Infrastructure\Persistence\MySQL;

use App\Domain\Orders\Repository\OrderRepositoryInterface;

final readonly class MySQLOrderRepository implements OrderRepositoryInterface
{
    public function __construct(
        private PDO $connection,
    ) {}

    public function find(OrderId $id): ?Order
    {
        $stmt = $this->connection->prepare('SELECT * FROM orders WHERE id = ?');
        $stmt->execute([$id->value()]);
        $data = $stmt->fetch(PDO::FETCH_ASSOC);

        return $data ? $this->hydrate($data) : null;
    }

    public function save(Order $order): void
    {
        // Convert domain entity to database record
        $data = $this->serialize($order);

        $stmt = $this->connection->prepare(
            'INSERT INTO orders (id, customer_id, total, status) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE total = ?, status = ?'
        );

        $stmt->execute([
            $data['id'],
            $data['customer_id'],
            $data['total'],
            $data['status'],
            $data['total'],
            $data['status'],
        ]);
    }
}
```

## Repository Pattern

Repositories abstract data access logic.

### Repository Interface (in Domain)

```php
namespace App\Domain\Orders\Repository;

interface OrderRepositoryInterface
{
    public function nextIdentity(): OrderId;
    public function find(OrderId $id): ?Order;
    public function findByCustomer(CustomerId $customerId): array;
    public function save(Order $order): void;
    public function remove(OrderId $id): void;
}
```

### Repository Implementation (in Infrastructure)

```php
namespace App\Infrastructure\Persistence;

final readonly class MySQLOrderRepository implements OrderRepositoryInterface
{
    public function nextIdentity(): OrderId
    {
        return new OrderId(Uuid::uuid4()->toString());
    }

    public function find(OrderId $id): ?Order
    {
        // SQL query to fetch order
        // Hydrate domain entity from database record
    }

    public function findByCustomer(CustomerId $customerId): array
    {
        // SQL query with WHERE customer_id = ?
        // Hydrate collection of entities
    }

    public function save(Order $order): void
    {
        // Serialize domain entity to database record
        // INSERT or UPDATE
    }

    public function remove(OrderId $id): void
    {
        // DELETE FROM orders WHERE id = ?
    }
}
```

### Benefits

- Domain layer isolated from persistence details
- Easy to test with in-memory implementations
- Can switch databases without changing domain
- Clear separation of concerns
