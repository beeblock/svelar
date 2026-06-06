<?php

declare(strict_types=1);

namespace App\Domain\{Module}\ValueObjects;

use InvalidArgumentException;

final readonly class {Name}
{
    private function __construct(
        public string $value,
    ) {
        $this->validate();
    }

    public static function from(string $value): self
    {
        return new self($value);
    }

    private function validate(): void
    {
        if (empty($this->value)) {
            throw new InvalidArgumentException('{Name} cannot be empty');
        }

        // Add more validation rules as needed
    }

    public function equals(self $other): bool
    {
        return $this->value === $other->value;
    }

    public function toString(): string
    {
        return $this->value;
    }
}
