import {auth} from './auth';
import {db, Prisma} from '@dance/db';
import {ZodError} from 'zod';
export class ApiError extends Error {
  constructor(public code: string, public status: number) {super(code);}
}
export async function actor(request: Request) {
  const expected = new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000').origin;
  if (request.headers.get('origin') !== expected) throw new ApiError('FORBIDDEN', 403);
  const session = await auth.api.getSession({headers: request.headers});
  if (!session) throw new ApiError('UNAUTHORIZED', 401);
  if (!session.user.emailVerified) throw new ApiError('VERIFY_EMAIL', 403);
  return {...session.user, profile: await db.profile.findUnique({where: {userId: session.user.id}})};
}
export async function jsonBody(request: Request) {
  const text = await request.text();
  if (text.length > 16000) throw new ApiError('INVALID_INPUT', 413);
  try { return JSON.parse(text); } catch {throw new ApiError('INVALID_INPUT', 400);}
}
export function apiError(error: unknown) {
  if (error instanceof ApiError) return Response.json({error: error.code}, {status: error.status});
  if (error instanceof ZodError) return Response.json({error: 'INVALID_INPUT'}, {status: 400});
  if (error instanceof Error && error.message === 'INVALID_TIME') return Response.json({error: 'INVALID_TIME'}, {status: 400});
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    return Response.json({error: 'HANDLE_TAKEN'}, {status: 409});
  console.error(JSON.stringify({level:'error',event:'api_error',message: error instanceof Error ? error.message : 'unknown'}));
  return Response.json({error: 'SERVER_ERROR'}, {status: 500});
}
