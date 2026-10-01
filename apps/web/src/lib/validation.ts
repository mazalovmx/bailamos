import {z} from 'zod';
import {DateTime} from 'luxon';
export const profileSchema = z.object({
  handle: z.string().trim().toLowerCase().min(3).max(30).regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().trim().min(2).max(80), bio: z.string().trim().max(1000),
  cityId: z.string().min(1), type: z.enum(['DANCER','ORGANIZER','SCHOOL','VENUE','ARTIST']),
  styleId: z.string().min(1), role: z.enum(['LEADER','FOLLOWER','BOTH']),
  level: z.enum(['NEWCOMER','BEGINNER','INTERMEDIATE','ADVANCED','PRO'])
});
export const eventSchema = z.object({
  title: z.string().trim().min(3).max(120), description: z.string().trim().min(10).max(5000),
  cityId: z.string().min(1), styleId: z.string().min(1),
  startsLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  endsLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  status: z.enum(['DRAFT','PUBLISHED','CANCELLED']),
  kind: z.enum(['CLASS','WORKSHOP','MASTERCLASS','INTENSIVE','PRACTICE','SOCIAL','FESTIVAL','OTHER']).default('SOCIAL'),
  format: z.enum(['SOLO','PARTNER','MIXED','UNSPECIFIED']).default('UNSPECIFIED'),
  level: z.enum(['OPEN','NEWCOMER','BEGINNER','IMPROVER','INTERMEDIATE','ADVANCED','PRO','UNSPECIFIED']).default('UNSPECIFIED'),
  intensity: z.enum(['RELAXED','MODERATE','ENERGETIC','UNSPECIFIED']).default('UNSPECIFIED'),
  tempo: z.enum(['SLOW','MEDIUM','FAST','VARIED','UNSPECIFIED']).default('UNSPECIFIED'),
  prerequisites: z.string().trim().max(1000).default(''),
  partnerRequired: z.boolean().default(false),
  tagIds: z.array(z.string().min(1)).max(8).default([]),
  recurrenceWeeks: z.coerce.number().int().min(1).max(52).default(1)
}).refine(value => value.format !== 'SOLO' || !value.partnerRequired, {path:['partnerRequired'],message:'Solo classes cannot require a partner'
});
export function eventTimes(start: string, end: string, timezone: string) {
  const from = DateTime.fromISO(start, {zone: timezone});
  const to = DateTime.fromISO(end, {zone: timezone});
  if (!from.isValid || !to.isValid || from.toFormat("yyyy-MM-dd'T'HH:mm") !== start ||
    to.toFormat("yyyy-MM-dd'T'HH:mm") !== end || from.getPossibleOffsets().length !== 1 ||
    to.getPossibleOffsets().length !== 1 || to <= from) throw new Error('INVALID_TIME');
  return {startsAt: from.toJSDate(), endsAt: to.toJSDate()};
}
