import {DateTime, IANAZone} from 'luxon';
// Client-safe time helpers: only Luxon, no database or server imports.
export const WALL = "yyyy-MM-dd'T'HH:mm:ss";
type Instant = Date | string;
export function inZone(value: Instant, zone: string) {
  const date = typeof value === 'string' ? DateTime.fromISO(value, {zone: 'UTC'}) : DateTime.fromJSDate(value, {zone: 'UTC'});
  const local = date.setZone(zone);
  if (!local.isValid) throw new Error('INVALID_TIME');
  return local;
}
// Wall-clock reading of a UTC instant in the given IANA zone, without offset: "2026-10-25T19:00:00".
export function wallClock(value: Instant, zone: string) { return inZone(value, zone).toFormat(WALL); }
// Short zone label for that instant, e.g. "CET", "GMT+3"; depends on the date because of DST.
export function zoneLabel(value: Instant, zone: string, locale = 'en') {
  return inZone(value, zone).setLocale(locale).offsetNameShort || zone;
}
function utcOffset(minutes: number) {
  const abs = Math.abs(minutes);
  return (minutes < 0 ? '-' : '+') + String(Math.floor(abs / 60)).padStart(2, '0') + String(abs % 60).padStart(2, '0');
}
// Offset changes of a zone inside [from, to], found by a daily scan and a binary search to the second.
export function transitions(zone: string, from: number, to: number) {
  const tz = IANAZone.create(zone), day = 86400000, found: {at: number; before: number; after: number}[] = [];
  if (!tz.isValid) throw new Error('INVALID_TIME');
  for (let start = from; start < to; start += day) {
    const before = tz.offset(start), after = tz.offset(start + day);
    if (before === after) continue;
    let low = start, high = start + day;
    while (high - low > 1000) { const mid = low + Math.floor((high - low) / 2000) * 1000; if (tz.offset(mid) === before) low = mid; else high = mid; }
    found.push({at: high, before, after});
  }
  return found;
}
// VTIMEZONE with one explicit observance per real transition around the exported range, so clients that do not
// know IANA names (Outlook) still get correct offsets on both sides of every DST change.
export function vtimezone(zone: string, from: Date, to: Date) {
  const year = 366 * 86400000, start = from.getTime() - year, tz = IANAZone.create(zone);
  const block = (at: number | null, before: number, after: number) => {
    // RFC 5545: DTSTART of an observance is the local onset time read with the offset in force before it.
    const onset = at === null ? '19700101T000000' : DateTime.fromMillis(at, {zone: 'UTC'}).plus({minutes: before}).toFormat("yyyyMMdd'T'HHmmss");
    const moment = DateTime.fromMillis(at ?? start, {zone}), kind = moment.isInDST ? 'DAYLIGHT' : 'STANDARD';
    return ['BEGIN:' + kind, 'DTSTART:' + onset, 'TZOFFSETFROM:' + utcOffset(before), 'TZOFFSETTO:' + utcOffset(after),
      'TZNAME:' + (moment.setLocale('en').offsetNameShort || zone), 'END:' + kind];
  };
  const initial = tz.offset(start);
  return ['BEGIN:VTIMEZONE', 'TZID:' + zone, 'X-LIC-LOCATION:' + zone, ...block(null, initial, initial),
    ...transitions(zone, start, to.getTime() + year).flatMap(t => block(t.at, t.before, t.after)), 'END:VTIMEZONE'].join('\r\n');
}
