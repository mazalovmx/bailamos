import {db} from '@dance/db';
import {z} from 'zod';
import {ModerationError, targetInfo, targetTypes} from './actions';
export const reportReasons = ['SPAM', 'HARASSMENT', 'INAPPROPRIATE', 'FAKE', 'COPYRIGHT', 'OTHER'] as const;
export const reportsPerHour = 10;
export const reportSchema = z.object({
  targetType: z.enum(targetTypes), targetId: z.string().min(1).max(64),
  reason: z.enum(reportReasons), comment: z.string().trim().max(1000).optional()
});
export type ReportInput = z.infer<typeof reportSchema>;
// One open report per user per object: a repeated report returns the existing one instead of flooding the queue.
export async function createReport(reporter: {id: string; profileId?: string | null}, input: ReportInput) {
  const info = await targetInfo(input.targetType, input.targetId);
  if (!info) throw new ModerationError('NOT_FOUND', 404);
  if (info.authorUserId === reporter.id) throw new ModerationError('OWN_CONTENT');
  if (input.targetType === 'MESSAGE') {
    // Messages are private: only a member of the conversation can report one, and others cannot probe message ids.
    const member = reporter.profileId && await db.message.findFirst({where: {id: input.targetId,
      conversation: {members: {some: {profileId: reporter.profileId}}}}, select: {id: true}});
    if (!member) throw new ModerationError('NOT_FOUND', 404);
  }
  return db.$transaction(async tx => {
    // Serialises one user's reports so that concurrent requests can neither duplicate a report nor slip past the hourly limit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'report:' + reporter.id}))`;
    const existing = await tx.report.findFirst({where: {reporterUserId: reporter.id, targetType: input.targetType, targetId: input.targetId, status: 'OPEN'}, select: {id: true}});
    if (existing) return {id: existing.id, created: false};
    const recent = await tx.report.count({where: {reporterUserId: reporter.id, createdAt: {gte: new Date(Date.now() - 3600_000)}}});
    if (recent >= reportsPerHour) throw new ModerationError('RATE_LIMITED', 429);
    const report = await tx.report.create({data: {reporterUserId: reporter.id, targetType: input.targetType, targetId: input.targetId,
      reason: input.reason, comment: input.comment || null}, select: {id: true}});
    return {id: report.id, created: true};
  });
}
