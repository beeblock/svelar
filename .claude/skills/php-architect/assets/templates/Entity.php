<?php

declare(strict_types=1);

namespace App\Domain\{BoundedContext}\Entity;

use App\Domain\{BoundedContext}\ValueObject\{ValueObject};

final class {Entity}
{
    public function __construct(
        private readonly {Id} $id,
        private string $property,
        // Add more properties as needed
    ) {}

    public static function create(
        {Id} $id,
        string $property,
    ): self {
        // Validation and business rules
        if (empty($property)) {
            throw new \InvalidArgumentException('Property cannot be empty');
        }

        return new self($id, $property);
    }

    public function id(): {Id}
    {
        return $this->id;
    }

    public function property(): string
    {
        return $this->property;
    }

    // Business methods
    public function updateProperty(string $newProperty): void
    {
        // Validation
        if (empty($newProperty)) {
            throw new \InvalidArgumentException('Property cannot be empty');
        }

        $this->property = $newProperty;
    }
}
