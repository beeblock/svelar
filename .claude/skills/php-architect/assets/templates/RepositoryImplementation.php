<?php

declare(strict_types=1);

namespace App\Infrastructure\Persistence\{BoundedContext};

use App\Domain\{BoundedContext}\Entity\{Entity};
use App\Domain\{BoundedContext}\Repository\{Entity}RepositoryInterface;
use App\Domain\{BoundedContext}\ValueObject\{Entity}Id;

final readonly class {Adapter}{Entity}Repository implements {Entity}RepositoryInterface
{
    public function __construct(
        private \PDO $connection,
    ) {}

    public function nextIdentity(): {Entity}Id
    {
        return {Entity}Id::generate();
    }

    public function find({Entity}Id $id): ?{Entity}
    {
        $stmt = $this->connection->prepare(
            'SELECT * FROM {table_name} WHERE id = ?'
        );
        $stmt->execute([$id->value()]);
        $data = $stmt->fetch(\PDO::FETCH_ASSOC);

        return $data ? $this->hydrate($data) : null;
    }

    public function save({Entity} $entity): void
    {
        $data = $this->serialize($entity);

        $stmt = $this->connection->prepare(
            'INSERT INTO {table_name} (id, property1, property2) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE property1 = ?, property2 = ?'
        );

        $stmt->execute([
            $data['id'],
            $data['property1'],
            $data['property2'],
            $data['property1'],
            $data['property2'],
        ]);
    }

    public function remove({Entity}Id $id): void
    {
        $stmt = $this->connection->prepare(
            'DELETE FROM {table_name} WHERE id = ?'
        );
        $stmt->execute([$id->value()]);
    }

    public function findByProperty(string $property): array
    {
        $stmt = $this->connection->prepare(
            'SELECT * FROM {table_name} WHERE property1 = ?'
        );
        $stmt->execute([$property]);

        return array_map(
            fn(array $data) => $this->hydrate($data),
            $stmt->fetchAll(\PDO::FETCH_ASSOC)
        );
    }

    private function hydrate(array $data): {Entity}
    {
        return {Entity}::create(
            id: {Entity}Id::from($data['id']),
            property: $data['property1'],
        );
    }

    private function serialize({Entity} $entity): array
    {
        return [
            'id' => $entity->id()->value(),
            'property1' => $entity->property(),
            // Add more properties
        ];
    }
}
