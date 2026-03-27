import { guardAuth } from 'svelar/auth';

export const load = guardAuth('/dashboard', { role: 'admin' });
