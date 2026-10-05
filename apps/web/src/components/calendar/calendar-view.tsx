'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {useTranslations} from 'next-intl';
import FullCalendar from '@fullcalendar/react';
import type {EventContentArg, EventInput, EventSourceFuncArg} from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import enLocale from '@fullcalendar/core/locales/en-gb';
import esLocale from '@fullcalendar/core/locales/es';
import ruLocale from '@fullcalendar/core/locales/ru';
import {wallClock, zoneLabel} from '../../lib/calendar/time';
import type {CalendarFilters, CalendarOccurrence} from '../../lib/calendar/query';
import {queryParams} from '../../lib/search-query';
import '../../app/styles/calendar.css';
const packs = {en: enLocale, es: esLocale, ru: ruLocale};
const DAY = 86400000, time = {hour: '2-digit', minute: '2-digit', hour12: false} as const;
type Loaded = {occurrences: CalendarOccurrence[]; truncated: boolean};
/*
 * Time zones without FullCalendar's extra time-zone plugins.
 * The calendar runs with `timeZone: 'UTC'` on purpose and is never given real instants. Every occurrence is turned
 * into a wall-clock string ("2026-10-25T19:00:00") with Luxon first - in the EVENT's zone by default, in the
 * visitor's zone when the toggle is on - and FullCalendar lays those strings out as if they were UTC. UTC has no
 * DST, so FullCalendar does no offset arithmetic at all: a 19:00 class sits at 19:00 on its own calendar day on
 * both sides of a DST change, and events from different cities share one grid of local clock time.
 * Consequences handled here: the fetched range is widened by a day on each side (a grid day is not a UTC day),
 * `now` is supplied as the visitor's wall clock, and links carry the real UTC instant.
 */
export function CalendarView({locale, filters,initialDate}: {locale: string; filters: CalendarFilters;initialDate?:string}) {
  const t = useTranslations('Calendar');
  const [view, setView] = useState<string | null>(null), [mine, setMine] = useState(false), [zone, setZone] = useState('UTC');
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle'), [truncated, setTruncated] = useState(false);
  const cache = useRef(new Map<string, Loaded>()), calendar = useRef<FullCalendar>(null);
  const initialRange=useRef(true);
  // Rendered after mount only: the initial view depends on the viewport (list on narrow screens) and the zone on the browser.
  useEffect(() => {
    setZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    setView(window.matchMedia('(max-width: 700px)').matches ? 'listMonth' : 'dayGridMonth');
  }, []);
  const query = (['city', 'style', 'level', 'kind'] as const).flatMap(key => filters[key].map(v => key + '=' + encodeURIComponent(v))).join('&')+'&'+queryParams(filters.extra||{});
  const events = useCallback(async (info: EventSourceFuncArg): Promise<EventInput[]> => {
    const from = new Date(info.start.getTime() - DAY).toISOString(), to = new Date(info.end.getTime() + DAY).toISOString();
    const key = from + '|' + to + '|' + query;
    let data = cache.current.get(key);
    if (!data) {
      setState('loading');
      try {
        const response = await fetch('/api/calendar/occurrences?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) + (query ? '&' + query : ''));
        if (!response.ok) throw new Error('LOAD');
        data = await response.json() as Loaded;
        cache.current.set(key, data);
      } catch (error) { setState('error'); throw error; }
    }
    setState('idle'); setTruncated(data.truncated);
    return data.occurrences.map(o => {
      const shown = mine ? zone : o.timezone;
      return {id: o.id, title: o.title, start: mine ? wallClock(o.startsAt, zone) : o.localStart,
        end: o.endsAt ? (mine ? wallClock(o.endsAt, zone) : o.localEnd!) : undefined,
        url: '/' + locale + '/events/' + o.slug + '?date=' + encodeURIComponent(o.startsAt),
        classNames: o.cancelled ? ['is-cancelled'] : [],
        extendedProps: {zone: zoneLabel(o.startsAt, shown, locale), place: o.venue ? o.venue + ', ' + o.city.name : o.city.name, cancelled: o.cancelled, moved: o.moved}};
    });
  }, [query, mine, zone, locale]);
  function content(arg: EventContentArg) {
    const {zone: label, place, cancelled, moved} = arg.event.extendedProps as {zone: string; place: string; cancelled: boolean; moved: boolean};
    // A cancelled date says so; otherwise a date that was moved on its own is marked as rescheduled.
    const flag = cancelled ? <span className="cal-cancelled"> {t('cancelled')}</span> : moved && <span className="cal-meta"> · {t('rescheduled')}</span>;
    // The list view has its own time column; its title cell needs a real link for keyboard users.
    if (arg.view.type.startsWith('list')) return <><a className="cal-title" href={arg.event.url}>{arg.event.title}</a><span className="cal-meta"> {place} · {label}</span>{flag}</>;
    return <><span className="cal-time">{arg.timeText} {label}</span> <span className="cal-title">{arg.event.title}</span><span className="cal-meta"> {place}</span>{flag}</>;
  }
  return <section className="calendar-view" aria-label={t('calendarLabel')}>
    <div className="calendar-zone">
      <label className="checkbox"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)}/>{t('toggleMyZone')}</label>
      <p>{mine ? t('zoneMine', {zone}) : t('zoneEventLocal')}</p>
    </div>
    <div className="calendar-status" role="status" aria-live="polite">
      {state === 'loading' && <p>{t('loading')}</p>}
      {state === 'error' && <p className="form-error">{t('loadError')} <button type="button" onClick={() => calendar.current?.getApi().refetchEvents()}>{t('retry')}</button></p>}
      {truncated && state === 'idle' && <p className="notice">{t('truncated')}</p>}
    </div>
    {view ? <div className="calendar-scroll"><FullCalendar ref={calendar} plugins={[dayGridPlugin, timeGridPlugin, listPlugin]}
      locales={[enLocale, esLocale, ruLocale]} locale={packs[locale as keyof typeof packs] || enLocale}
      timeZone="UTC" now={() => wallClock(new Date(), zone)} nowIndicator
      initialDate={initialDate}
      datesSet={({view})=>{if(initialRange.current){initialRange.current=false;return;}
        const params=new URLSearchParams(window.location.search);
        params.set('from',view.currentStart.toISOString().slice(0,10));params.set('to',new Date(view.currentEnd.getTime()-DAY).toISOString().slice(0,10));
        window.history.replaceState(null,'',window.location.pathname+'?'+params);
      }}
      initialView={view} headerToolbar={{left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listMonth'}}
      height="auto" dayMaxEvents={4} nextDayThreshold="06:00:00" scrollTime="16:00:00" allDaySlot={false} navLinks={false}
      eventDisplay="block" displayEventEnd={false} eventTimeFormat={time} slotLabelFormat={time}
      events={events} eventContent={content}/></div> : <p className="calendar-placeholder">{t('loading')}</p>}
  </section>;
}
