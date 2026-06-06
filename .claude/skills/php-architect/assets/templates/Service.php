<?php

declare(strict_types=1);

namespace App\Domain\{BoundedContext}\Service;

use App\Domain\{BoundedContext}\Entity\{Entity};
use App\Domain\{BoundedContext}\Repository\{Repository}Interface;

final readonly class {Service}
{
    public function __construct(
        private {Repository}Interface $repository,
    ) {}

    public function execute({Entity} $entity): void
    {
        // Domain logic here

        $this->repository->save($entity);
    }
}
