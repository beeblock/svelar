<?php

declare(strict_types=1);

namespace App\Interfaces\{Module}\Http\Controllers;

use App\Domain\{Module}\Actions\{Name}Action;
use App\Domain\{Module}\DTOs\{Name}DTO;
use App\Interfaces\{Module}\Http\Requests\{Name}Request;
use App\Interfaces\{Module}\Http\Resources\{Entity}Resource;
use Illuminate\Http\JsonResponse;

final class {Name}Controller
{
    public function __construct(
        private {Name}Action $action,
    ) {}

    public function __invoke({Name}Request $request): JsonResponse
    {
        $dto = {Name}DTO::fromArray($request->validated());

        $result = $this->action->execute($dto);

        return response()->json(
            new {Entity}Resource($result),
            201
        );
    }
}
