<?php

declare(strict_types=1);

namespace App\Domain\{BoundedContext}\Repository;

use App\Domain\{BoundedContext}\Entity\{Entity};
use App\Domain\{BoundedContext}\ValueObject\{Entity}Id;

interface {Entity}RepositoryInterface
{
    public function nextIdentity(): {Entity}Id;

    public function find({Entity}Id $id): ?{Entity};

    public function save({Entity} $entity): void;

    public function remove({Entity}Id $id): void;

    // Add query methods as needed
    public function findByProperty(string $property): array;
}
