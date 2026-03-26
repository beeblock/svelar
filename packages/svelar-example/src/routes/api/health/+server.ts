import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

export const GET: RequestHandler = async () => {
  return json({
    status: 'ok',
    framework: 'svelar',
    timestamp: new Date().toISOString(),
  });
};
