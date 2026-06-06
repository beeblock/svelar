# PSR Standards Guide

This reference covers the PHP Standards Recommendations (PSR) from PHP-FIG that should be followed in all PHP projects.

## Table of Contents
- [PSR-1: Basic Coding Standard](#psr-1-basic-coding-standard)
- [PSR-4: Autoloading Standard](#psr-4-autoloading-standard)
- [PSR-12: Extended Coding Style](#psr-12-extended-coding-style)
- [PSR-3: Logger Interface](#psr-3-logger-interface)
- [PSR-7: HTTP Message Interface](#psr-7-http-message-interface)
- [PSR-11: Container Interface](#psr-11-container-interface)
- [PSR-14: Event Dispatcher](#psr-14-event-dispatcher)
- [PSR-15: HTTP Handlers](#psr-15-http-handlers)

## PSR-1: Basic Coding Standard

### Overview
PSR-1 provides baseline coding requirements for PHP code interoperability.

### Key Requirements

**Files:**
- Must use only `<?php` and `<?=` tags
- Must use UTF-8 without BOM
- Should either declare symbols OR cause side-effects, but not both

```php
<?php

declare(strict_types=1);

namespace App\Domain\Orders;

// ✅ Good: Only declares symbols
final readonly class Order
{
    // Class declaration
}
```

```php
<?php

// ✅ Good: Only side effects (configuration file)
ini_set('display_errors', '1');
require_once __DIR__ . '/bootstrap.php';
```

**Naming:**
- Class names in `StudlyCase` (PascalCase)
- Method names in `camelCase`
- Constants in `UPPER_SNAKE_CASE`

```php
// ✅ Good
final class OrderRepository
{
    private const MAX_RESULTS = 100;

    public function findById(string $id): ?Order
    {
        // Implementation
    }
}
```

## PSR-4: Autoloading Standard

### Overview
PSR-4 defines how classes are autoloaded based on file paths.

### Structure

```
vendor-name/package-name/
├── composer.json
└── src/
    └── Domain/
        └── Orders/
            └── Order.php  (Class: VendorName\PackageName\Domain\Orders\Order)
```

### composer.json Configuration

```json
{
    "autoload": {
        "psr-4": {
            "App\\": "src/"
        }
    }
}
```

### Mapping Rules

| Fully Qualified Class Name | Namespace Prefix | Base Directory | Resulting File Path |
|----------------------------|------------------|----------------|---------------------|
| `App\Domain\Orders\Order` | `App\` | `src/` | `src/Domain/Orders/Order.php` |
| `App\Application\Command\CreateOrder` | `App\` | `src/` | `src/Application/Command/CreateOrder.php` |

### Example

```php
<?php

declare(strict_types=1);

namespace App\Domain\Orders; // Must match directory structure

final class Order
{
    // Class in src/Domain/Orders/Order.php
}
```

## PSR-12: Extended Coding Style

### Overview
PSR-12 extends PSR-1 with comprehensive coding style rules.

### Key Rules

**Declare Statements:**
```php
<?php

declare(strict_types=1);

namespace App\Domain\Orders;

use App\Domain\Shared\ValueObject\Money;
use App\Domain\Orders\ValueObject\OrderId;
```

**Classes:**
```php
final readonly class Order extends AbstractEntity implements OrderInterface
{
    // Opening brace on new line after class declaration
}
```

**Methods:**
```php
public function calculateTotal(
    Money $subtotal,
    TaxRate $taxRate,
    ?Discount $discount = null
): Money {
    // Opening brace on same line, parameters can be multi-line
}
```

**Control Structures:**
```php
// if statement
if ($order->isPending()) {
    $order->complete();
} elseif ($order->isProcessing()) {
    $order->cancel();
} else {
    throw new InvalidStateException();
}

// foreach
foreach ($items as $item) {
    $total = $total->add($item->price());
}

// match expression (PHP 8.0+)
$status = match($order->status()) {
    OrderStatus::Pending => 'Waiting',
    OrderStatus::Completed => 'Done',
    default => 'Unknown',
};
```

**Type Declarations:**
```php
// ✅ Good: Space after colon, type declarations
public function process(Order $order): OrderResult
{
    // Implementation
}

// ✅ Good: Nullable types
public function find(string $id): ?Order
{
    // Implementation
}

// ✅ Good: Union types (PHP 8.0+)
public function parse(string|int $value): ParsedValue
{
    // Implementation
}
```

## PSR-3: Logger Interface

### Overview
Common interface for logging libraries.

### Interface

```php
namespace Psr\Log;

interface LoggerInterface
{
    public function emergency(string|\Stringable $message, array $context = []): void;
    public function alert(string|\Stringable $message, array $context = []): void;
    public function critical(string|\Stringable $message, array $context = []): void;
    public function error(string|\Stringable $message, array $context = []): void;
    public function warning(string|\Stringable $message, array $context = []): void;
    public function notice(string|\Stringable $message, array $context = []): void;
    public function info(string|\Stringable $message, array $context = []): void;
    public function debug(string|\Stringable $message, array $context = []): void;
    public function log($level, string|\Stringable $message, array $context = []): void;
}
```

### Usage

```php
use Psr\Log\LoggerInterface;

final readonly class OrderService
{
    public function __construct(
        private LoggerInterface $logger,
    ) {}

    public function createOrder(CreateOrderDTO $dto): Order
    {
        $this->logger->info('Creating order', [
            'customer_id' => $dto->customerId,
            'items_count' => count($dto->lineItems),
        ]);

        try {
            $order = Order::create($dto->customerId, $dto->lineItems);
            $this->logger->info('Order created successfully', ['order_id' => $order->id()]);
            return $order;
        } catch (\Exception $e) {
            $this->logger->error('Failed to create order', [
                'error' => $e->getMessage(),
                'customer_id' => $dto->customerId,
            ]);
            throw $e;
        }
    }
}
```

## PSR-7: HTTP Message Interface

### Overview
Common interfaces for HTTP requests and responses.

### Request Interface

```php
use Psr\Http\Message\ServerRequestInterface;

function handleRequest(ServerRequestInterface $request): ResponseInterface
{
    $method = $request->getMethod(); // GET, POST, etc.
    $uri = $request->getUri();
    $headers = $request->getHeaders();
    $body = $request->getBody();
    $queryParams = $request->getQueryParams();
    $parsedBody = $request->getParsedBody();

    // Handle request
}
```

### Response Interface

```php
use Psr\Http\Message\ResponseInterface;

function createResponse(): ResponseInterface
{
    return $response
        ->withStatus(200)
        ->withHeader('Content-Type', 'application/json')
        ->withBody($stream);
}
```

### Immutability

PSR-7 messages are immutable:

```php
// ✅ Good: Returns new instance
$newResponse = $response->withStatus(404);

// ❌ Bad: Doesn't mutate original
$response->withStatus(404); // This does nothing!
```

## PSR-11: Container Interface

### Overview
Common interface for dependency injection containers.

### Interface

```php
namespace Psr\Container;

interface ContainerInterface
{
    public function get(string $id): mixed;
    public function has(string $id): bool;
}
```

### Usage

```php
use Psr\Container\ContainerInterface;

final readonly class OrderController
{
    public function __construct(
        private ContainerInterface $container,
    ) {}

    public function createOrder(ServerRequestInterface $request): ResponseInterface
    {
        // Get service from container
        $service = $this->container->get(CreateOrderService::class);

        // Use service
        $order = $service->execute($dto);

        return new JsonResponse($order);
    }
}
```

## PSR-14: Event Dispatcher

### Overview
Common interfaces for event dispatching.

### Interfaces

```php
namespace Psr\EventDispatcher;

interface EventDispatcherInterface
{
    public function dispatch(object $event): object;
}

interface ListenerProviderInterface
{
    public function getListenersForEvent(object $event): iterable;
}
```

### Usage

```php
use Psr\EventDispatcher\EventDispatcherInterface;

final readonly class OrderService
{
    public function __construct(
        private OrderRepositoryInterface $repository,
        private EventDispatcherInterface $eventDispatcher,
    ) {}

    public function createOrder(CreateOrderDTO $dto): Order
    {
        $order = Order::create($dto->customerId, $dto->lineItems);
        $this->repository->save($order);

        // Dispatch domain event
        $event = new OrderWasCreated($order->id(), $order->customerId());
        $this->eventDispatcher->dispatch($event);

        return $order;
    }
}
```

## PSR-15: HTTP Handlers

### Overview
Common interfaces for HTTP server request handlers and middleware.

### Request Handler Interface

```php
namespace Psr\Http\Server;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

interface RequestHandlerInterface
{
    public function handle(ServerRequestInterface $request): ResponseInterface;
}
```

### Middleware Interface

```php
namespace Psr\Http\Server;

interface MiddlewareInterface
{
    public function process(
        ServerRequestInterface $request,
        RequestHandlerInterface $handler
    ): ResponseInterface;
}
```

### Usage Example

```php
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Message\ResponseInterface;

final readonly class AuthenticationMiddleware implements MiddlewareInterface
{
    public function process(
        ServerRequestInterface $request,
        RequestHandlerInterface $handler
    ): ResponseInterface {
        // Check authentication
        $token = $request->getHeaderLine('Authorization');

        if (!$this->isValidToken($token)) {
            return new JsonResponse(['error' => 'Unauthorized'], 401);
        }

        // Add user to request
        $user = $this->getUserFromToken($token);
        $request = $request->withAttribute('user', $user);

        // Pass to next handler
        return $handler->handle($request);
    }
}
```

## Best Practices

### 1. Always Declare Strict Types

```php
<?php

declare(strict_types=1);

namespace App\Domain\Orders;
```

### 2. Use Type Declarations

```php
// ✅ Good: Full type declarations
public function calculateTotal(Money $subtotal, TaxRate $rate): Money
{
    return $subtotal->multiply($rate->value());
}

// ❌ Bad: No type declarations
public function calculateTotal($subtotal, $rate)
{
    return $subtotal->multiply($rate->value());
}
```

### 3. Follow PSR-4 Autoloading

Ensure namespace matches directory structure:
- `App\Domain\Orders\Order` → `src/Domain/Orders/Order.php`
- `App\Application\Command\CreateOrder` → `src/Application/Command/CreateOrder.php`

### 4. Use PSR Interfaces for Common Concerns

Instead of concrete implementations, depend on PSR interfaces:
- `Psr\Log\LoggerInterface` for logging
- `Psr\Http\Message\ServerRequestInterface` for HTTP requests
- `Psr\Container\ContainerInterface` for DI containers
- `Psr\EventDispatcher\EventDispatcherInterface` for events

### 5. Immutable Messages

When working with PSR-7, remember messages are immutable:

```php
// ✅ Good: Assign returned value
$response = $response
    ->withStatus(200)
    ->withHeader('Content-Type', 'application/json');

// ❌ Bad: Discarding returned value
$response->withStatus(200); // Does nothing!
```
