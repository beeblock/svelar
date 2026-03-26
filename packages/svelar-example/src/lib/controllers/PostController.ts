import { Controller } from 'svelar/routing';
import { CreatePostRequest } from '../dtos/CreatePostRequest.js';
import { UpdatePostRequest } from '../dtos/UpdatePostRequest.js';
import { PostService } from '../services/PostService.js';
import { CreatePostAction } from '../actions/CreatePostAction.js';

const postService = new PostService();
const createPostAction = new CreatePostAction();

/**
 * PostController — Full CRUD with DDD architecture.
 *
 * Flow: Controller → DTO validation → Service/Action → Repository → Model
 */
export class PostController extends Controller {
  /** GET /api/posts — List published posts (or all if ?all=true) */
  async index(event: any) {
    const showAll = event.url.searchParams.get('all') === 'true';

    if (showAll && event.locals.user) {
      const posts = await postService.findAll();
      return this.json(posts);
    }

    const posts = await postService.findPublished();
    return this.json(posts);
  }

  /** GET /api/posts/:id — Show a single post */
  async show(event: any) {
    const post = await postService.findByIdOrFail(event.params.id);
    return this.json(post);
  }

  /** POST /api/posts — Create a new post (authenticated) */
  async store(event: any) {
    const data = await CreatePostRequest.validate(event);
    const userId = event.locals.user?.id;

    if (!userId) {
      return this.json({ message: 'Unauthenticated' }, 401);
    }

    const post = await createPostAction.run({
      userId,
      title: data.title,
      slug: data.slug,
      body: data.body,
      published: data.published,
    });

    return this.created(post);
  }

  /** PUT /api/posts/:id — Update a post (authenticated) */
  async update(event: any) {
    const data = await UpdatePostRequest.validate(event);
    const post = await postService.update(event.params.id, data);
    return this.json(post);
  }

  /** DELETE /api/posts/:id — Delete a post (authenticated) */
  async destroy(event: any) {
    await postService.delete(event.params.id);
    return this.noContent();
  }

  /** GET /api/posts/mine — Get current user's posts */
  async mine(event: any) {
    const userId = event.locals.user?.id;
    if (!userId) {
      return this.json({ message: 'Unauthenticated' }, 401);
    }

    const posts = await postService.findByUser(userId);
    return this.json(posts);
  }
}
