import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async () => {
  // Redirect /docs to the getting started page
  throw redirect(302, '/docs/getting-started');
};
