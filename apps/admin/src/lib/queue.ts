import {db} from '@dance/db';
import {mediaUrl} from './env';
import {targetInfo} from './moderation';
// The spec promises a moderator response within 24 hours; older open reports are flagged everywhere.
export const overdueMs = 24 * 3600_000;
export const overdueBefore = () => new Date(Date.now() - overdueMs);
// Open reports grouped by reported object, newest first, each with a preview of the content and its author.
export async function moderationQueue(page: number, size = 20) {
  const open = await db.report.findMany({where: {status: 'OPEN'}, orderBy: {createdAt: 'desc'}, take: 2000,
    select: {id: true, targetType: true, targetId: true, reason: true, comment: true, createdAt: true, reporter: {select: {id: true, name: true, email: true}}}});
  const groups = new Map<string, typeof open>();
  for (const report of open) {
    const key = report.targetType + ':' + report.targetId;
    groups.set(key, [...(groups.get(key) ?? []), report]);
  }
  const data = await Promise.all([...groups.entries()].slice((page - 1) * size, page * size).map(async ([key, reports]) => {
    const {targetType, targetId} = reports[0], oldest = reports[reports.length - 1].createdAt;
    const [info, total] = await Promise.all([targetInfo(targetType, targetId), db.report.count({where: {targetType, targetId}})]);
    const author = info?.authorUserId ? await db.user.findUnique({where: {id: info.authorUserId},
      select: {id: true, name: true, email: true, role: true, bannedAt: true}}) : null;
    return {key, targetType, targetId, total, oldest, overdue: oldest < overdueBefore(), reports, author,
      target: info && {title: info.title, text: info.text, hiddenAt: info.hiddenAt, path: info.path, imageUrl: info.mediaKey ? mediaUrl(info.mediaKey) : null}};
  }));
  return {data, total: groups.size};
}
export async function dashboardCounts() {
  const [openReports, overdueReports, pendingClaims, reviewItems, users, bannedUsers, events, profiles] = await Promise.all([
    db.report.count({where: {status: 'OPEN'}}), db.report.count({where: {status: 'OPEN', createdAt: {lt: overdueBefore()}}}),
    db.profileClaim.count({where: {status: 'PENDING'}}), db.importedItem.count({where: {status: 'REVIEW'}}),
    db.user.count(), db.user.count({where: {bannedAt: {not: null}}}), db.event.count(), db.profile.count()]);
  return {openReports, overdueReports, pendingClaims, reviewItems, users, bannedUsers, events, profiles};
}
