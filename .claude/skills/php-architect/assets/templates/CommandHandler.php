<?php

declare(strict_types=1);

namespace App\Application\{BoundedContext}\Command;

use App\Domain\{BoundedContext}\Entity\{Entity};
use App\Domain\{BoundedContext}\Repository\{Repository}Interface;
use Psr\EventDispatcher\EventDispatcherInterface;

final readonly class {Name}CommandHandler
{
    public function __construct(
        private {Repository}Interface $repository,
        private EventDispatcherInterface $eventDispatcher,
    ) {}

    public function handle({Name}Command $command): string
    {
        // Create domain entity
        $entity = {Entity}::create(
            id: $this->repository->nextIdentity(),
            property: $command->property1,
        );

        // Save entity
        $this->repository->save($entity);

        // Dispatch domain event
        $this->eventDispatcher->dispatch(
            new {Entity}WasCreated($entity->id()->value())
        );

        return $entity->id()->value();
    }
}
