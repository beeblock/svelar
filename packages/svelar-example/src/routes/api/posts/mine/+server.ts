import { PostController } from '$lib/controllers/PostController.js';

const ctrl = new PostController();
export const GET = ctrl.handle('mine');
