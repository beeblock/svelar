<?php

declare(strict_types=1);

namespace App\Domain\{Module}\Actions;

use App\Domain\{Module}\DTOs\{Name}DTO;
use App\Domain\{Module}\Entities\{Entity};
use App\Domain\{Module}\Events\{Event};
use App\Domain\{Module}\Repositories\{Repository}Interface;

final readonly class {Name}Action
{
    public function __construct(
        private {Repository}Interface $repository,
    ) {}

    public function execute({Name}DTO $dto): {Entity}
    {
        // Domain logic here
        $entity = {Entity}::create(
            // ... constructor arguments from DTO
        );

        $this->repository->save($entity);

        // Dispatch domain event if needed
        event(new {Event}($entity->id));

        return $entity;
    }
}
