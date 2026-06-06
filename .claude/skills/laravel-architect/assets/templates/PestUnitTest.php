<?php

use App\Domain\{Module}\Entities\{Entity};
use App\Domain\{Module}\ValueObjects\{ValueObject};

test('{entity} {behavior description}', function () {
    // Arrange
    $value = {ValueObject}::from('test-value');

    // Act
    $entity = {Entity}::create(
        property: $value,
    );

    // Assert
    expect($entity)
        ->toBeInstanceOf({Entity}::class)
        ->and($entity->property)->toEqual($value);
});

it('validates {validation rule}', function () {
    expect(fn() => {Entity}::create(property: null))
        ->toThrow(InvalidArgumentException::class);
});
