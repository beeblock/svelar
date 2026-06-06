<?php

declare(strict_types=1);

namespace App\Application\{BoundedContext}\Query;

final readonly class {Name}QueryHandler
{
    public function __construct(
        private \PDO $readDatabase,
    ) {}

    public function handle({Name}Query $query): ?array
    {
        $stmt = $this->readDatabase->prepare(
            'SELECT * FROM {view_name} WHERE id = ?'
        );
        $stmt->execute([$query->id]);

        $result = $stmt->fetch(\PDO::FETCH_ASSOC);

        return $result ?: null;
    }
}
