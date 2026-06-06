# Architecture Patterns

This reference provides detailed guidance on modular development, event-driven architecture, and module communication patterns.

## Table of Contents
- [Module Principles](#module-principles)
- [Module Structure](#module-structure)
- [Event-Driven Architecture](#event-driven-architecture)
- [Inter-Module Communication](#inter-module-communication)
- [Anti-Corruption Layer](#anti-corruption-layer)

## Module Principles

Each module in the system follows these principles:

- Each module owns its **data**, **logic**, and **UI**
- Modules communicate through **well-defined interfaces**
- Modules can be **deployed independently** (if needed)
- Dependencies flow **inward** (infrastructure → application → domain)

## Module Structure

A complete module example with all layers:

```
modules/
├── Billing/
│   ├── Domain/
│   │   ├── Contracts/
│   │   │   └── BillingServiceInterface.php
│   │   ├── Entities/
│   │   │   └── Invoice.php
│   │   ├── Events/
│   │   │   └── InvoiceWasPaid.php
│   │   └── ValueObjects/
│   │       └── Money.php
│   ├── Infrastructure/
│   │   ├── Models/
│   │   ├── Repositories/
│   │   └── Providers/
│   │       └── BillingServiceProvider.php
│   ├── Application/
│   │   ├── Actions/
│   │   │   └── ProcessPaymentAction.php
│   │   └── Listeners/
│   └── Interfaces/
│       └── Http/
│           └── Controllers/
├── Inventory/
├── Orders/
└── Shipping/
```

## Event-Driven Architecture

Events are first-class citizens in the system architecture.

### Domain Events

Domain events are immutable records of things that happened:

```php
// Domain events are immutable records of things that happened
final readonly class OrderWasPlaced
{
    public function __construct(
        public string $orderId,
        public string $customerId,
        public array $lineItems,
        public DateTimeImmutable $occurredAt,
    ) {}
}
```

### Event Design Principles

- Events are **past tense** (something that happened)
- Events are **immutable** (never change after creation)
- Events carry **all necessary data** (no lazy loading)
- Events are **named from the domain perspective**

### Event Flow Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Action    │────▶│   Domain    │────▶│   Event     │
│  (Command)  │     │   Logic     │     │  Dispatch   │
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         ▼                         ▼
            ┌─────────────┐           ┌─────────────┐           ┌─────────────┐
            │  Listener   │           │  Listener   │           │  Listener   │
            │  (Sync)     │           │  (Queued)   │           │  (Queued)   │
            └─────────────┘           └─────────────┘           └─────────────┘
            Send Email                Update Analytics          Notify Warehouse
```

### Laravel Event Implementation

- Use Laravel's event system for application events
- Consider dedicated event bus for complex scenarios
- Queue listeners for non-critical side effects
- Use event sourcing for audit-critical domains

### Patterns to Apply

- **Event Sourcing** when audit trail is critical
- **CQRS** when read/write patterns diverge significantly
- **Saga/Process Manager** for long-running workflows
- **Outbox Pattern** for reliable event publishing

## Inter-Module Communication

Modules expose clean interfaces and other modules depend on those interfaces:

```php
// ✅ Good: Module exposes a clean interface
// modules/Billing/Domain/Contracts/BillingServiceInterface.php
interface BillingServiceInterface
{
    public function createInvoice(CreateInvoiceDTO $dto): InvoiceDTO;
    public function processPayment(string $invoiceId, PaymentMethodDTO $method): PaymentResultDTO;
}

// Other modules depend on the interface, not implementation
class OrderCompletionAction
{
    public function __construct(
        private BillingServiceInterface $billing,
    ) {}
}
```

### Communication Guidelines

1. **Use DTOs for data transfer** between modules
2. **Depend on interfaces**, not concrete implementations
3. **Emit events** for notifications to other modules
4. **Never directly access** another module's infrastructure layer
5. **Use facades sparingly** and only for application-wide concerns

## Anti-Corruption Layer

When integrating with external systems or legacy code, use an anti-corruption layer to translate external concepts to domain language:

```php
// Translate external concepts to your domain language
class ExternalPaymentGatewayAdapter implements PaymentGatewayInterface
{
    public function charge(Money $amount, PaymentMethod $method): PaymentResult
    {
        // Translate to external API format
        $externalResult = $this->client->processCharge([
            'amount' => $amount->cents(),
            'currency' => $amount->currency()->code(),
            'payment_method' => [
                'type' => $method->type(),
                'token' => $method->token(),
            ],
        ]);

        // Translate back to domain concepts
        return PaymentResult::fromExternalResponse($externalResult);
    }
}
```

### When to Use Anti-Corruption Layer

- Integrating with third-party APIs
- Working with legacy systems
- Protecting domain from external changes
- Translating between different ubiquitous languages
