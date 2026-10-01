import Link from 'next/link';
import {pageStaff} from '../../lib/guard';
import {getT} from '../../lib/i18n';
import {dashboardCounts} from '../../lib/queue';
export const dynamic = 'force-dynamic';
export default async function Dashboard() {
  await pageStaff();
  const [t, counts] = await Promise.all([getT(), dashboardCounts()]);
  const tiles: [string, number, string][] = [
    ['dashboard.openReports', counts.openReports, '/moderation'], ['dashboard.pendingClaims', counts.pendingClaims, '/claims'],
    ['dashboard.reviewItems', counts.reviewItems, '/r/imported-items?status=REVIEW'], ['dashboard.users', counts.users, '/r/users'],
    ['dashboard.bannedUsers', counts.bannedUsers, '/r/users?bannedAt__null=false'], ['dashboard.events', counts.events, '/r/events'],
    ['dashboard.profiles', counts.profiles, '/r/profiles']];
  return <>
    <h1>{t('nav.dashboard')}</h1>
    {counts.overdueReports > 0
      ? <p className="notice danger" role="status"><strong>{t('dashboard.overdue', {count: counts.overdueReports})}</strong> <Link href="/moderation">{t('nav.queue')}</Link></p>
      : <p className="success" role="status">{t('dashboard.onTime')}</p>}
    <ul className="tiles">{tiles.map(([key, count, href]) => <li key={key}><Link href={href}><span className="count">{count}</span><span>{t(key)}</span></Link></li>)}</ul>
  </>;
}
