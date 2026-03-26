import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { superValidate, message, setError } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { registerSchema } from '$lib/schemas/auth';
import { AuthService } from '$lib/services/AuthService';

const authService = new AuthService();

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) throw redirect(302, '/dashboard');

  const form = await superValidate(zod(registerSchema));
  return { form };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const form = await superValidate(request, zod(registerSchema));

    if (!form.valid) {
      return fail(400, { form });
    }

    const result = await authService.register({
      name: form.data.name,
      email: form.data.email,
      password: form.data.password,
    });

    if (!result.success) {
      // If email already taken, show on the email field
      if (result.error?.includes('Email')) {
        return setError(form, 'email', result.error);
      }
      return message(form, result.error || 'Registration failed', { status: 422 });
    }

    const user = result.data!;
    locals.session.set('auth_user_id', (user as any).id);
    locals.session.regenerateId();

    throw redirect(302, '/dashboard');
  },
};
