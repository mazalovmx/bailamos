import {z} from 'zod';
import {one, remove, update} from '../../../../../lib/crud';
import {route} from '../../../../../lib/guard';
import {HttpError} from '../../../../../lib/errors';
import {resource} from '../../../../../lib/resources';
type Context = {params: Promise<{resource: string; id: string}>};
const removal = z.object({reason: z.string().trim().max(1000).optional()});
async function payload(request: Request) {
  const text = await request.text();
  if (text.length > 64000) throw new HttpError('INVALID_INPUT', 413);
  try {return text ? JSON.parse(text) as unknown : {};} catch {throw new HttpError('INVALID_INPUT', 400);}
}
export const GET = route<Context>('STAFF', async (_request, _user, {params}) => {
  const {resource: name, id} = await params;
  return Response.json({data: await one(resource(name), id)});
});
export const PATCH = route<Context>('STAFF', async (request, user, {params}) => {
  const {resource: name, id} = await params;
  return Response.json({data: await update(resource(name), id, await payload(request), user)});
});
export const DELETE = route<Context>('STAFF', async (request, user, {params}) => {
  const {resource: name, id} = await params;
  const {reason} = removal.parse(await payload(request));
  return Response.json({data: await remove(resource(name), id, user, reason || null)});
});
