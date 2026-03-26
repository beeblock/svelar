import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { createPostSchema } from '$lib/schemas/post';
import { Post } from '$lib/models/Post';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(302, '/login');

  const form = await superValidate(zod(createPostSchema));

  // Fetch user's posts directly from the model
  let posts: any[] = [];
  try {
    const models = await Post.where('user_id', (locals.user as any).id).get() as any[];
    posts = models.map((p: any) => ({ id: p.id, title: p.title, slug: p.slug, body: p.body, published: !!p.published, user_id: p.user_id, created_at: p.created_at, updated_at: p.updated_at }));
  } catch {}

  return {
    user: {
      id: (locals.user as any).id,
      name: (locals.user as any).name,
      email: (locals.user as any).email,
    },
    posts,
    form,
  };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    if (!locals.user) throw redirect(302, '/login');

    const form = await superValidate(request, zod(createPostSchema));

    if (!form.valid) {
      return fail(400, { form });
    }

    try {
      const slug = form.data.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      await Post.create({
        title: form.data.title,
        body: form.data.body,
        slug,
        published: form.data.published,
        user_id: (locals.user as any).id,
      });

      return message(form, 'Post created successfully!');
    } catch (err: any) {
      return message(form, err.message || 'Failed to create post', { status: 500 });
    }
  },

  delete: async ({ request, locals }) => {
    if (!locals.user) throw redirect(302, '/login');

    const data = await request.formData();
    const postId = data.get('postId');

    if (postId) {
      try {
        const post = await Post.find(Number(postId));
        if (post && (post as any).user_id === (locals.user as any).id) {
          await (post as any).delete();
        }
      } catch {}
    }

    return { success: true };
  },

  toggle: async ({ request, locals }) => {
    if (!locals.user) throw redirect(302, '/login');

    const data = await request.formData();
    const postId = data.get('postId');

    if (postId) {
      try {
        const post = await Post.find(Number(postId));
        if (post && (post as any).user_id === (locals.user as any).id) {
          await (post as any).update({ published: !(post as any).published });
        }
      } catch {}
    }

    return { success: true };
  },
};
