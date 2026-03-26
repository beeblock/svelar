import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { loginSchema } from '$lib/schemas/auth';
import { AuthService } from '$lib/services/AuthService';

const authService = new AuthService();

export const load: PageServerLoad = async ({ locals }) => {
  // Redirect if already logged in
  if (locals.user) throw redirect(302, '/dashboard');

  const form = await superValidate(zod(loginSchema));
  return { form };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const form = await superValidate(request, zod(loginSchema));

    if (!form.valid) {
      return fail(400, { form });
    }

    const result = await authService.login(form.data.email, form.data.password);

    if (!result.success) {
      return message(form, 'Invalid email or password', { status: 401 });
    }

    const user = result.data!;
    locals.session.set('auth_user_id', (user as any).id);
    locals.session.regenerateId();

    throw redirect(302, '/dashboard');
  },
};
