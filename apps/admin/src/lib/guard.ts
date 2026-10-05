import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {ZodError} from 'zod';
import {db, Prisma, EventConflict} from '@dance/db';
import {auth} from './auth';
import {adminOrigin} from './env';
import {HttpError} from './errors';
import {ModerationError} from './moderation';
export type Staff = {id: string; name: string; email: string; role: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'SCHOOL_ADMIN'};
// The single place that decides who is staff. Role and ban are read from the database on every request,
// so a demotion or a ban takes effect at once even while the session cookie is still valid.
async function staffFrom(source: Headers): Promise<Staff | null> {
  const session = await auth.api.getSession({headers: source});
  if (!session) return null;
  const user = await db.user.findUnique({where: {id: session.user.id},
    select: {id: true, name: true, email: true, role: true, bannedAt: true, emailVerified: true}});
  if (!user || user.bannedAt || !user.emailVerified || user.role === 'USER') return null;
  return {id: user.id, name: user.name, email: user.email, role: user.role};
}
// Guard for every API route. Anything that is not a read must come from the panel's own origin.
export async function staff(request: Request, need: 'STAFF' | 'ADMIN' | 'SCHOOL' = 'STAFF') {
  if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('origin') !== adminOrigin()) throw new HttpError('FORBIDDEN', 403);
  const user = await staffFrom(request.headers);
  if (!user) throw new HttpError('UNAUTHORIZED', 401);
  if ((user.role === 'SCHOOL_ADMIN' && need !== 'SCHOOL') || (need === 'SCHOOL' && user.role === 'MODERATOR')) throw new HttpError('FORBIDDEN', 403);
  if (need === 'ADMIN' && !['OWNER','ADMIN'].includes(user.role)) throw new HttpError('ADMIN_ONLY', 403);
  return user;
}
// Guard for every server-rendered page.
export async function pageStaff(allowSchool = false) {
  const user = await staffFrom(await headers());
  if (!user) redirect('/login');
  if (user.role === 'SCHOOL_ADMIN' && !allowSchool) redirect('/schools');
  return user;
}
export const currentStaff = async () => staffFrom(await headers());
export async function jsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 64000) throw new HttpError('INVALID_INPUT', 413);
  try {return JSON.parse(text);} catch {throw new HttpError('INVALID_INPUT', 400);}
}
export function fail(error: unknown) {
  const reply = (code: string, status: number, extra?: object) => Response.json({error: code, ...extra}, {status});
  if (error instanceof HttpError || error instanceof ModerationError || error instanceof EventConflict) return reply(error.code, error.status);
  if (error instanceof ZodError) return reply('INVALID_INPUT', 400, {fields: [...new Set(error.issues.map(issue => String(issue.path[0] ?? '')))].filter(Boolean)});
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return reply('NOT_UNIQUE', 409);
    if (error.code === 'P2003' || error.code === 'P2014') return reply('IN_USE', 409);
    if (error.code === 'P2025') return reply('NOT_FOUND', 404);
  }
  console.error(JSON.stringify({level: 'error', event: 'admin_api_error', message: error instanceof Error ? error.message : 'unknown'}));
  return reply('SERVER_ERROR', 500);
}
// Wraps a route handler: authenticates staff first, then turns thrown errors into JSON responses.
export function route<C>(need: 'STAFF' | 'ADMIN' | 'SCHOOL', handler: (request: Request, user: Staff, context: C) => Promise<Response>) {
  return async (request: Request, context: C) => {
    try {return await handler(request, await staff(request, need), context);} catch (error) {return fail(error);}
  };
}
