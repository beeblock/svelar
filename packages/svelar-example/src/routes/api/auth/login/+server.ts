import { AuthController } from '$lib/controllers/AuthController.js';

const ctrl = new AuthController();
export const POST = ctrl.handle('login');
