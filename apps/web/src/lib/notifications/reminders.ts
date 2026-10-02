import {db} from '@dance/db';
import {notify} from '../notify';
import {sendEventReminderEmail} from './email';
import {pushEnabled} from './push';
import {attendeeProfileIds} from '../events/attendees';
import './register';
export const REMINDER_LEAD_MINUTES = 120;
/**
 * Reminds everyone who is "going" to an occurrence that starts within the next two hours. For a series the answer
 * that counts is the effective one for that date: an answer given for the date itself, else the answer for the whole
 * series. So "not this date" silences the reminder and "going" to this date only earns one.
 * Call it every `intervalMinutes` (5 by default): the window is widened by one interval, so a reminder goes out
 * between 2 h 05 min and 1 h 55 min before the start. An occurrence that enters the window late (created or
 * published shortly before it starts, or the scheduler was down) is still reminded once, as long as it has not started.
 * The UPDATE … WHERE "reminderSentAt" IS NULL … RETURNING claim is atomic: with several workers each occurrence
 * is taken by exactly one of them, and a second run finds nothing.
 */
export async function sendEventReminders(now = new Date(), intervalMinutes = 5) {
  const until = new Date(now.getTime() + (REMINDER_LEAD_MINUTES + intervalMinutes) * 60000);
  const claimed = await db.$queryRaw<{id: string}[]>`
    UPDATE "EventOccurrence" o SET "reminderSentAt" = ${now}
    FROM "Event" e
    WHERE e."id" = o."eventId" AND o."reminderSentAt" IS NULL AND o."cancelled" = false
      AND e."status" = 'PUBLISHED' AND e."hiddenAt" IS NULL
      AND o."startsAt" > ${now} AND o."startsAt" <= ${until}
    RETURNING o."id"`;
  const result = {occurrences: claimed.length, notified: 0, mailed: 0};
  if (!claimed.length) return result;
  const occurrences = await db.eventOccurrence.findMany({where: {id: {in: claimed.map(row => row.id)}}, select: {id: true, startsAt: true,
    event: {select: {id: true, slug: true, title: true, timezone: true, venue: {select: {name: true}}}}}});
  for (const occurrence of occurrences) {
    const {event} = occurrence;
    const going = await attendeeProfileIds(event.id, occurrence.id, ['GOING']);
    const users = going.length ? await db.user.findMany({where: {profile: {id: {in: going}}, bannedAt: null}, select: {id: true,
      notificationPreference: {select: {emailEvents: true}}, _count: {select: {pushSubscriptions: true}}}}) : [];
    if (!users.length) continue;
    const data = {eventId: event.id, slug: event.slug, title: event.title, occurrenceId: occurrence.id,
      startsAt: occurrence.startsAt.toISOString(), timezone: event.timezone, ...(event.venue ? {place: event.venue.name} : {})};
    // Stored without a locale: the centre, the push payload and the email each add the reader's own.
    const url = '/events/' + event.slug;
    try {
      await notify(users.map(user => user.id), 'EVENT_REMINDER', data, url);
      result.notified += users.length;
      // Email is the fallback channel for people who cannot be reached by push on any device.
      const byMail = users.filter(user => (user.notificationPreference?.emailEvents ?? true) && (!pushEnabled() || !user._count.pushSubscriptions));
      const sent = await Promise.all(byMail.map(user => sendEventReminderEmail(user.id, data, url)));
      result.mailed += sent.filter(Boolean).length;
    } catch (error) {
      // The claim stays: a reminder is sent at most once, never twice.
      console.error(JSON.stringify({level: 'error', event: 'reminder_failed', occurrenceId: occurrence.id, message: error instanceof Error ? error.message : 'unknown'}));
    }
  }
  return result;
}
