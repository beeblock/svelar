<?php

declare(strict_types=1);

namespace App\Domain\{Module}\DTOs;

final readonly class {Name}DTO
{
    public function __construct(
        public string $property1,
        public string $property2,
        // Add more properties as needed
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            property1: $data['property1'],
            property2: $data['property2'],
        );
    }

    public function toArray(): array
    {
        return [
            'property1' => $this->property1,
            'property2' => $this->property2,
        ];
    }
}
