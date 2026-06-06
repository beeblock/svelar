<?php

declare(strict_types=1);

namespace App\Application\{BoundedContext}\DTO;

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
            property1: $data['property1'] ?? throw new \InvalidArgumentException('property1 is required'),
            property2: $data['property2'] ?? throw new \InvalidArgumentException('property2 is required'),
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
