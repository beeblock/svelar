<?php

declare(strict_types=1);

namespace App\Domain\{Module}\Repositories;

use App\Domain\{Module}\Entities\{Entity};

interface {Entity}RepositoryInterface
{
    public function find(string $id): ?{Entity};

    public function save({Entity} $entity): void;

    public function delete(string $id): void;

    // Add query methods as needed
    public function findByCustomerId(string $customerId): array;
}
