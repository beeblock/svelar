import { guardAuth } from 'svelar/auth';

export const load = guardAuth();
