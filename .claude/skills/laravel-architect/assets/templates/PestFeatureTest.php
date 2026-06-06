<?php

use App\Infrastructure\{Module}\Models\{Entity}Model;

test('user can {action description}', function () {
    // Arrange
    $data = [
        'field1' => 'value1',
        'field2' => 'value2',
    ];

    // Act
    $response = $this->postJson('/api/{endpoint}', $data);

    // Assert
    $response->assertStatus(201)
        ->assertJsonStructure([
            'id',
            'field1',
            'field2',
        ]);

    expect({Entity}Model::count())->toBe(1);
});

it('validates required fields', function () {
    $response = $this->postJson('/api/{endpoint}', []);

    $response->assertStatus(422)
        ->assertJsonValidationErrors(['field1', 'field2']);
});

it('prevents unauthorized access', function () {
    $response = $this->getJson('/api/{endpoint}/123');

    $response->assertStatus(401);
});
