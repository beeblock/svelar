import { Gate } from 'svelar/auth';

/**
 * Admin access gate - only admins can access protected routes
 */
Gate.define('admin-access', (user) => user?.role === 'admin');

/**
 * Edit post gate - user can edit their own posts or admins can edit any post
 */
Gate.define('edit-post', (user, post) => {
  if (!user) return false;
  return user.id === post.user_id || user.role === 'admin';
});

/**
 * Delete post gate - user can delete their own posts or admins can delete any post
 */
Gate.define('delete-post', (user, post) => {
  if (!user) return false;
  return user.id === post.user_id || user.role === 'admin';
});

/**
 * Manage users gate - only admins can manage users
 */
Gate.define('manage-users', (user) => user?.role === 'admin');

/**
 * Super user gate - admins have all permissions
 */
Gate.defineSuperUser((user) => user?.role === 'admin');
