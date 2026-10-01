import {z} from 'zod';
import {db} from '@dance/db';
import {HttpError} from '../../../../lib/errors';
import {jsonBody, route} from '../../../../lib/guard';
import {audit} from '../../../../lib/moderation';
const schema = z.object({approve: z.boolean(), note: z.string().trim().max(500).optional()});
// A disputed (REVIEW) item is either sent back to the importer as PENDING with note "APPROVED", which tells it to skip
// de-duplication and create the event, or rejected for good. The importer itself is a separate epic.
export const POST = route<{params: Promise<{id: string}>}>('STAFF', async (request, user, {params}) => {
  const {id} = await params, {approve, note} = schema.parse(await jsonBody(request));
  const status = approve ? 'PENDING' as const : 'REJECTED' as const;
  await db.$transaction(async tx => {
    const changed = await tx.importedItem.updateMany({where: {id, status: 'REVIEW'}, data: {status, note: approve ? 'APPROVED' : note || 'REJECTED'}});
    if (!changed.count) {
      const exists = await tx.importedItem.count({where: {id}});
      throw new HttpError(exists ? 'ALREADY_DECIDED' : 'NOT_FOUND', exists ? 409 : 404);
    }
    await audit(tx, user.id, approve ? 'IMPORT_APPROVE' : 'IMPORT_REJECT', 'ImportedItem', id, {note: note || null});
  });
  return Response.json({status});
});
