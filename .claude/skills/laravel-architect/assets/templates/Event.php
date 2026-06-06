<?php

declare(strict_types=1);

namespace App\Domain\{Module}\Events;

use DateTimeImmutable;

final readonly class {Name}Event
{
    public function __construct(
        public string $id,
        public string $relatedId,
        // Add more event data as needed
        public DateTimeImmutable $occurredAt = new DateTimeImmutable(),
    ) {}
}
