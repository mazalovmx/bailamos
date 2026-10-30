import {useLocale, useTranslations} from 'next-intl';
import {googleCalendarUrl, icsUrl, outlookCalendarUrl, yahooCalendarUrl} from '../../lib/calendar/links';
import '../../app/styles/calendar.css';
// Works as a server or a client component. `startsAt`/`endsAt` are UTC ISO strings of the shown occurrence,
// `timezone` is the event's IANA zone, `url` the absolute event page URL put into the calendar entry.
export function AddToCalendar({eventId, title, startsAt, endsAt, timezone, location, details, url}:
  {eventId: string; title: string; startsAt: string; endsAt?: string | null; timezone: string; location: string; details?: string; url: string}) {
  const t = useTranslations('Calendar'), locale = useLocale();
  const event = {title, timezone, location, details, url}, occurrence = {startsAt, endsAt};
  const ics = icsUrl(eventId) + (locale === 'en' ? '' : '?locale=' + locale);
  const external = (href: string, label: string) => <a className="button secondary" href={href} target="_blank" rel="noopener noreferrer">{label}<span aria-hidden="true"> ↗</span></a>;
  // Google first; the others behind one more click. Apple Calendar and any other app open the .ics file.
  return <div className="add-to-calendar" role="group" aria-label={t('addToCalendar')}>
    {external(googleCalendarUrl(event, occurrence), t('addGoogle'))}
    <details className="more-calendars"><summary>{t('otherCalendars')}</summary>
      <div className="more-calendars-list">
        <a className="button secondary" href={ics} download>{t('addApple')}</a>
        {external(outlookCalendarUrl(event, occurrence, 'live'), t('addOutlook'))}
        {external(outlookCalendarUrl(event, occurrence, 'office'), t('addOffice'))}
        {external(yahooCalendarUrl(event, occurrence), t('addYahoo'))}
      </div>
    </details>
  </div>;
}
