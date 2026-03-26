import { Middleware, type MiddlewareContext, type NextFunction } from 'svelar/middleware';

/**
 * Example auth middleware — checks for Bearer token.
 * Replace the TODO with real token verification.
 */
export class AuthMiddleware extends Middleware {
  async handle(ctx: MiddlewareContext, next: NextFunction): Promise<Response | void> {
    const token = ctx.event.request.headers.get('authorization')?.replace('Bearer ', '');

    if (!token) {
      return new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // TODO: Verify token and load user
    // const user = await User.where('api_token', token).first();
    // if (!user) return new Response(...);
    // ctx.event.locals.user = user;

    return next();
  }
}
