import {useLocale, useTranslations} from 'next-intl';
import {googleCalendarUrl, icsUrl} from '../../lib/calendar/links';
import '../../app/styles/calendar.css';
// Works as a server or a client component. `startsAt`/`endsAt` are UTC ISO strings of the shown occurrence,
// `timezone` is the event's IANA zone, `url` the absolute event page URL put into the calendar entry.
export function AddToCalendar({eventId, title, startsAt, endsAt, timezone, location, details, url}:
  {eventId: string; title: string; startsAt: string; endsAt?: string | null; timezone: string; location: string; details?: string; url: string}) {
  const t = useTranslations('Calendar'), locale = useLocale();
  return <div className="add-to-calendar" role="group" aria-label={t('addToCalendar')}>
    <a className="button secondary" href={icsUrl(eventId) + (locale === 'en' ? '' : '?locale=' + locale)} download>{t('downloadIcs')}</a>
    <a className="button secondary" href={googleCalendarUrl({title, timezone, location, details, url}, {startsAt, endsAt})} target="_blank" rel="noopener noreferrer">{t('addGoogle')}<span aria-hidden="true"> ↗</span></a>
  </div>;
}
