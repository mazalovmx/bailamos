import Link from 'next/link';
import {getTranslations} from 'next-intl/server';
import type {Week} from '../../lib/courses/timetable';
// Previous / next week links that keep the other query parameters. `current` is the week containing today.
export async function WeekNav({week, current, path, query, locale}: {week: Week; current: Week; path: string; query: Record<string, string>; locale: string}) {
  const t = await getTranslations('Courses');
  const href = (start?: string) => {
    const params = new URLSearchParams(query);
    if (start) params.set('week', start); else params.delete('week');
    const text = params.toString();
    return path + (text ? '?' + text : '');
  };
  const format = new Intl.DateTimeFormat(locale, {day: 'numeric', month: 'long', timeZone: 'UTC'}), noon = (date: string) => new Date(date + 'T12:00:00Z');
  return <nav className="week-nav" aria-label={t('weekNav')}>
    <Link href={href(week.previous)} rel="nofollow">← {t('previousWeek')}</Link>
    <p><strong>{t('weekRange', {from: format.format(noon(week.start)), to: format.format(noon(week.end))})}</strong></p>
    <Link href={href(week.next)} rel="nofollow">{t('nextWeek')} →</Link>
    {week.start !== current.start && <Link href={href()}>{t('thisWeek')}</Link>}
  </nav>;
}
