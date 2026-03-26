import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types.js';

export const actions: Actions = {
  default: async (event) => {
    event.locals.session.forget('auth_user_id');
    event.locals.session.regenerateId();
    throw redirect(302, '/');
  },
};
