<?php

declare(strict_types=1);

use App\Domain\{BoundedContext}\Entity\{Entity};
use App\Domain\{BoundedContext}\ValueObject\{ValueObject};

// Unit Test
test('{entity} {behavior description}', function () {
    // Arrange
    $value = {ValueObject}::from('test-value');

    // Act
    $entity = {Entity}::create(
        id: {Entity}Id::generate(),
        property: $value,
    );

    // Assert
    expect($entity)
        ->toBeInstanceOf({Entity}::class)
        ->and($entity->property())->toEqual($value);
});

// Edge Case Test
it('validates {validation rule}', function () {
    expect(fn() => {Entity}::create(
        id: {Entity}Id::generate(),
        property: '',
    ))->toThrow(InvalidArgumentException::class);
});

// Integration Test
test('repository saves and retrieves {entity}', function () {
    $repository = new {Adapter}{Entity}Repository($pdo);

    $entity = {Entity}::create(
        id: $repository->nextIdentity(),
        property: 'test',
    );

    $repository->save($entity);
    $retrieved = $repository->find($entity->id());

    expect($retrieved)->not->toBeNull()
        ->and($retrieved->id())->toEqual($entity->id())
        ->and($retrieved->property())->toEqual($entity->property());
});
