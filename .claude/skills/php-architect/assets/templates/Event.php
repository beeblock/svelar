<?php

declare(strict_types=1);

namespace App\Domain\{BoundedContext}\Event;

final readonly class {Entity}Was{Action}
{
    public function __construct(
        public string $entityId,
        public \DateTimeImmutable $occurredAt = new \DateTimeImmutable(),
    ) {}
}
