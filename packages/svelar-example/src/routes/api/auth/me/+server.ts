import { AuthController } from '$lib/controllers/AuthController.js';

const ctrl = new AuthController();
export const GET = ctrl.handle('me');
