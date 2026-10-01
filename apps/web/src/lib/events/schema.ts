import {z} from 'zod';
import {eventKinds,danceFormats,classLevels,intensities,tempos} from '../swing';
import {weekdays,MAX_DATES,MAX_INTERVAL} from '../schedule';
export const attendeeVisibilities=['PUBLIC','ATTENDEES','ORGANIZERS'] as const;
export const eventStatuses=['DRAFT','PUBLISHED','CANCELLED'] as const;
const local=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
// Full event payload of POST /api/events and PATCH /api/events/[id]. Unknown keys (ownership, coordinates) are dropped.
export const eventInput=z.object({
  title:z.string().trim().min(3).max(120),description:z.string().trim().min(10).max(5000),
  cityId:z.string().min(1).max(64),styleId:z.string().min(1).max(64),
  venueId:z.string().max(64).nullish().transform(value=>value||null),
  // Set only on creation, and only for a school the author manages; checked in the route.
  schoolProfileId:z.string().max(64).nullish().transform(value=>value||null),
  priceText:z.string().trim().max(120).nullish().transform(value=>value||null),
  attendeeVisibility:z.enum(attendeeVisibilities).default('PUBLIC'),
  startsLocal:local,endsLocal:local,
  status:z.enum(eventStatuses),
  kind:z.enum(eventKinds).default('SOCIAL'),format:z.enum(danceFormats).default('UNSPECIFIED'),
  level:z.enum(classLevels).default('UNSPECIFIED'),intensity:z.enum(intensities).default('UNSPECIFIED'),
  tempo:z.enum(tempos).default('UNSPECIFIED'),
  prerequisites:z.string().trim().max(1000).default(''),
  partnerRequired:z.boolean().default(false),
  tagIds:z.array(z.string().min(1).max(64)).max(8).default([]),
  // Recurrence: a number of dates (1 = single event) or, alternatively, a last local day.
  recurrenceWeeks:z.coerce.number().int().min(1).max(MAX_DATES).default(1),
  recurrenceInterval:z.coerce.number().int().min(1).max(MAX_INTERVAL).default(1),
  recurrenceDays:z.array(z.enum(weekdays)).max(7).default([]),
  recurrenceUntil:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal('')).transform(value=>value||null)
}).refine(value=>value.format!=='SOLO'||!value.partnerRequired,{path:['partnerRequired'],message:'Solo classes cannot require a partner'});
export type EventInput=z.infer<typeof eventInput>;
// A body with nothing but a status is a quick publish / cancel / back-to-draft.
export const statusInput=z.object({status:z.enum(eventStatuses)}).strict();
export const occurrenceInput=z.object({cancelled:z.boolean()}).strict();
const handle=z.string().trim().toLowerCase().transform(value=>value.replace(/^@/,'')).pipe(z.string().regex(/^[a-z0-9][a-z0-9_-]{2,29}$/));
export const inviteInput=z.union([
  z.object({handle}).strict(),
  z.object({email:z.string().trim().toLowerCase().max(254).pipe(z.email())}).strict()
]);
export const inviteAnswer=z.object({action:z.enum(['accept','decline'])}).strict();
export const artistInput=z.union([
  z.object({handle}).strict(),
  z.object({name:z.string().trim().min(2).max(80),type:z.enum(['ARTIST','SCHOOL']).default('ARTIST')}).strict()
]);
export const rsvpInput=z.object({status:z.enum(['GOING','INTERESTED','DECLINED'])});
