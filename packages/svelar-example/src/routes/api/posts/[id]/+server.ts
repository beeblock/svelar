import { PostController } from '$lib/controllers/PostController.js';

const ctrl = new PostController();
export const GET = ctrl.handle('show');
export const PUT = ctrl.handle('update');
export const DELETE = ctrl.handle('destroy');
