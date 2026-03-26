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
    const path = issue.path.join('.') || '_root';
    if (!errors[path]) errors[path] = [];
    errors[path].push(issue.message);
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
console.log('Has user.email:', 'user.email' in result.errors);
console.log('Keys:', Object.keys(result.errors));
