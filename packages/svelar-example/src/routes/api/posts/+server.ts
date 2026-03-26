import { PostController } from '$lib/controllers/PostController.js';

const ctrl = new PostController();
export const GET = ctrl.handle('index');
export const POST = ctrl.handle('store');
