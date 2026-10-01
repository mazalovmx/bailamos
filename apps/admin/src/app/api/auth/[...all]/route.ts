import {toNextJsHandler} from 'better-auth/next-js';
import {auth} from '../../../../lib/auth';
const handlers = toNextJsHandler(auth);
// The panel only signs staff in and out; every other Better Auth endpoint (profile updates, password changes, …) stays in the web app.
const allowed = new Set(['/api/auth/sign-in/email', '/api/auth/sign-out', '/api/auth/get-session']);
const gate = (handler: (request: Request) => Promise<Response>) => async (request: Request) =>
  allowed.has(new URL(request.url).pathname) ? handler(request) : Response.json({error: 'NOT_FOUND'}, {status: 404});
export const GET = gate(handlers.GET), POST = gate(handlers.POST);
