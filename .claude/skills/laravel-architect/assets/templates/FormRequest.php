<?php

declare(strict_types=1);

namespace App\Interfaces\{Module}\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class {Name}Request extends FormRequest
{
    public function authorize(): bool
    {
        return true; // Implement authorization logic
    }

    public function rules(): array
    {
        return [
            'field1' => ['required', 'string', 'max:255'],
            'field2' => ['required', 'integer', 'min:1'],
            // Add more validation rules
        ];
    }

    public function messages(): array
    {
        return [
            'field1.required' => 'The field1 is required.',
            // Add custom error messages
        ];
    }
}
