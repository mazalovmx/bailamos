import Link from 'next/link';
import {getTranslations} from 'next-intl/server';
import type {Timetable} from '../../lib/courses/timetable';
import '../../app/styles/courses.css';
// Week timetable. One list in the document, so screen readers and phones get a day-grouped list;
// from 1100px the same list is laid out as a Monday-to-Sunday grid.
export async function WeekTimetable({timetable, locale, showCity = false, hideHost}: {timetable: Timetable; locale: string; showCity?: boolean; hideHost?: string}) {
  const [t, app] = await Promise.all([getTranslations('Courses'), getTranslations('App')]);
  const noon = (date: string) => new Date(date + 'T12:00:00Z');
  const weekday = new Intl.DateTimeFormat(locale, {weekday: 'long', timeZone: 'UTC'}), dayMonth = new Intl.DateTimeFormat(locale, {day: 'numeric', month: 'short', timeZone: 'UTC'});
  return <ol className="timetable" aria-label={t('timetableLabel', {from: dayMonth.format(noon(timetable.week.start)), to: dayMonth.format(noon(timetable.week.end))})}>
    {timetable.days.map(day => <li key={day.date} className={day.entries.length ? 'timetable-day' : 'timetable-day timetable-day-empty'}>
      <h3><span>{weekday.format(noon(day.date))}</span> <time dateTime={day.date}>{dayMonth.format(noon(day.date))}</time></h3>
      {day.entries.length ? <ul>{day.entries.map(entry => {
        const hosts = entry.hosts.filter(host => host.handle !== hideHost);
        return <li key={entry.id} className="timetable-entry">
          <p className="timetable-time"><time dateTime={entry.startsAt}>{entry.localStart}{entry.localEnd ? '–' + entry.localEnd : ''}</time>
            {showCity && <span> · {entry.city.name}</span>}</p>
          <Link className="timetable-title" href={'/' + locale + '/events/' + entry.slug + '?date=' + encodeURIComponent(entry.startsAt)}>{entry.title}</Link>
          <dl>
            <div><dt>{t('level')}</dt><dd>{app('level_' + entry.level)}</dd></div>
            <div><dt>{t('price')}</dt><dd>{entry.priceText || t('priceUnknown')}</dd></div>
            <div><dt>{t('venue')}</dt><dd>{entry.venue ? <Link href={'/' + locale + '/venues/' + entry.venue.id}>{entry.venue.name}</Link> : t('venueUnknown')}</dd></div>
            {hosts.length > 0 && <div><dt>{t('host')}</dt><dd>{hosts.map((host, index) => <span key={host.handle}>{index > 0 && ', '}
              <Link href={'/' + locale + (host.type === 'SCHOOL' ? '/schools/' : '/people/') + host.handle}>{host.name}</Link></span>)}</dd></div>}
          </dl>
          {(entry.kind !== 'CLASS' || entry.styles.length > 0) && <p className="timetable-tags">{[...(entry.kind !== 'CLASS' ? [app('kind_' + entry.kind)] : []), ...entry.styles.map(style => style.name)].join(' · ')}</p>}
        </li>;
      })}</ul> : <p className="timetable-none">{t('noClassesDay')}</p>}
    </li>)}
  </ol>;
}
