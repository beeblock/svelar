<?php

declare(strict_types=1);

namespace App\Infrastructure\{Module}\Repositories;

use App\Domain\{Module}\Entities\{Entity};
use App\Domain\{Module}\Repositories\{Entity}RepositoryInterface;
use App\Infrastructure\{Module}\Models\{Entity}Model;

final class Eloquent{Entity}Repository implements {Entity}RepositoryInterface
{
    public function find(string $id): ?{Entity}
    {
        $model = {Entity}Model::find($id);

        return $model ? $this->toDomain($model) : null;
    }

    public function save({Entity} $entity): void
    {
        {Entity}Model::updateOrCreate(
            ['id' => $entity->id],
            $this->toArray($entity)
        );
    }

    public function delete(string $id): void
    {
        {Entity}Model::destroy($id);
    }

    public function findByCustomerId(string $customerId): array
    {
        return {Entity}Model::where('customer_id', $customerId)
            ->get()
            ->map(fn($model) => $this->toDomain($model))
            ->all();
    }

    private function toDomain({Entity}Model $model): {Entity}
    {
        return {Entity}::reconstitute(
            id: $model->id,
            // Map model properties to entity
        );
    }

    private function toArray({Entity} $entity): array
    {
        return [
            'id' => $entity->id,
            // Map entity properties to array
        ];
    }
}
