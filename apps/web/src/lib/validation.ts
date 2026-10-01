import {z} from 'zod';
import {DateTime} from 'luxon';
export const profileTypes = ['DANCER','ORGANIZER','SCHOOL','VENUE','ARTIST'] as const;
export const danceRoles = ['LEADER','FOLLOWER','BOTH'] as const;
export const skillLevels = ['NEWCOMER','BEGINNER','INTERMEDIATE','ADVANCED','PRO'] as const;
const handle = z.string().trim().toLowerCase().min(3).max(30).regex(/^[a-z0-9][a-z0-9_-]*$/);
// An Instagram username only: never a URL, an access token or free text. A leading "@" is accepted and dropped.
export const instagramUsername = z.string().trim().toLowerCase().transform(value => value.replace(/^@/, ''))
  .pipe(z.string().regex(/^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{1,30}$/));
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform(value => value || null);
export const profileSchema = z.object({
  handle, name: z.string().trim().min(2).max(80), bio: z.string().trim().max(1000).default(''),
  cityId: z.string().min(1).max(64), type: z.enum(profileTypes),
  district: optionalText(80),
  instagram: z.union([z.literal(''), z.null(), instagramUsername]).optional().transform(value => value || null),
  // Legacy single-skill fields: when all three are sent, that skill is added without touching the others.
  styleId: z.string().min(1).max(64).optional(), role: z.enum(danceRoles).optional(), level: z.enum(skillLevels).optional()
});
// "Looking for a partner" is false unless the request says true for that exact skill.
export const skillSchema = z.object({
  styleId: z.string().min(1).max(64), role: z.enum(danceRoles), level: z.enum(skillLevels),
  lookingFor: z.boolean().default(false)
});
export const skillsSchema = z.object({skills: z.array(skillSchema).max(20)})
  .refine(value => new Set(value.skills.map(s => s.styleId + ':' + s.role)).size === value.skills.length, {path: ['skills'], message: 'DUPLICATE_SKILL'});
export const onboardingSchema = z.object({
  cityId: z.string().min(1).max(64), styleIds: z.array(z.string().min(1).max(64)).min(1).max(10),
  role: z.enum(danceRoles), level: z.enum(skillLevels), consent: z.boolean().default(false)
}).refine(value => new Set(value.styleIds).size === value.styleIds.length, {path: ['styleIds'], message: 'DUPLICATE_SKILL'});
export const claimSchema = z.object({handle, message: z.string().trim().min(10).max(1000)});
export const deleteAccountSchema = z.object({password: z.string().min(1).max(128).optional(), confirmEmail: z.string().trim().max(254).optional()});
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
