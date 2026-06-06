<?php

use App\Domain\{Module}\Actions\{Name}Action;
use App\Domain\{Module}\DTOs\{Name}DTO;
use App\Domain\{Module}\Repositories\{Repository}Interface;

test('action {behavior description}', function () {
    // Arrange
    $repository = app({Repository}Interface::class);
    $action = new {Name}Action($repository);

    $dto = new {Name}DTO(
        property1: 'value1',
        property2: 'value2',
    );

    // Act
    $result = $action->execute($dto);

    // Assert
    expect($result)
        ->toBeInstanceOf({Entity}::class)
        ->and($result->property1)->toBe('value1');
});

it('handles error conditions', function () {
    $action = app({Name}Action::class);

    $invalidDto = new {Name}DTO(
        property1: '',
        property2: '',
    );

    expect(fn() => $action->execute($invalidDto))
        ->toThrow(InvalidArgumentException::class);
});
