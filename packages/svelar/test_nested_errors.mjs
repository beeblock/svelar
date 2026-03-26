import { z } from 'zod';

const rules = {
  email: () => z.string().email('Must be a valid email address'),
};

function validate(schema, data) {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = {};
  for (const issue of result.error.issues) {
    const path = issue.path.length > 0 ? issue.path : ['_root'];

    // Navigate/create nested object structure
    let current = errors;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key];
    }

    // Set the error message array at the final key
    const finalKey = path[path.length - 1];
    if (!current[finalKey]) {
      current[finalKey] = [];
    }
    current[finalKey].push(issue.message);
  }

  return { success: false, errors };
}

const schema = z.object({
  user: z.object({
    email: rules.email(),
  }),
});

const result = validate(schema, {
  user: {
    email: 'bad-email',
  },
});

console.log('Result:', JSON.stringify(result, null, 2));

// Test nested access (what toHaveProperty does)
const keys = 'user.email'.split('.');
let obj = result.errors;
for (const k of keys) {
  console.log(`Checking key "${k}" in:`, Object.keys(obj));
  if (!(k in obj)) {
    console.log('FAILED: key not found');
  } else {
    obj = obj[k];
  }
}
console.log('Final value:', obj);
