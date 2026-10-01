import {db} from '@dance/db';
import {importApproved, ReviewError, type Outcome} from './create';
// Manual decisions on disputed imports. The admin panel has its own endpoint that only flips the status
// (REVIEW → PENDING with note "APPROVED", or → REJECTED) and leaves the creation to the worker; these functions do the
// same thing in one step and are what the worker ends up calling for the approved ones.
export {ReviewError};
export async function approveItem(id: string, actorUserId: string): Promise<Outcome> {
  const item = await db.importedItem.findUnique({where: {id}, include: {source: {select: {url: true}}}});
  if (!item) throw new ReviewError('NOT_FOUND', 404);
  if (item.status !== 'REVIEW' && !(item.status === 'PENDING' && item.note === 'APPROVED')) throw new ReviewError('ALREADY_DECIDED', 409);
  return importApproved(item, actorUserId);
}
export async function rejectItem(id: string, actorUserId: string, note?: string | null): Promise<Outcome> {
  const text = (note || '').trim().slice(0, 500) || 'REJECTED';
  await db.$transaction(async tx => {
    const changed = await tx.importedItem.updateMany({where: {id, status: 'REVIEW'}, data: {status: 'REJECTED', note: text}});
    if (!changed.count) {
      const exists = await tx.importedItem.count({where: {id}});
      throw new ReviewError(exists ? 'ALREADY_DECIDED' : 'NOT_FOUND', exists ? 409 : 404);
    }
    await tx.auditLog.create({data: {actorUserId, action: 'IMPORT_REJECT', targetType: 'ImportedItem', targetId: id, data: {note: note?.trim().slice(0, 500) || null}}});
  });
  return {status: 'REJECTED', eventId: null, note: text};
}
