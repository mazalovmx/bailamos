import {z} from 'zod';
// Query-string validation for every geo endpoint. Values stay strings until they pass a strict pattern:
// z.coerce would silently turn '' and null into 0, which is a valid coordinate.
const DAY = 86400000;
const decimal = z.string().regex(/^-?\d{1,3}(\.\d{1,12})?$/).transform(Number);
export const latitude = decimal.pipe(z.number().min(-90).max(90));
export const longitude = decimal.pipe(z.number().min(-180).max(180));
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/)
  .refine(value => !Number.isNaN(new Date(value).getTime()));
// Catalogue ids are slugs in the seed and cuids for rows created later.
const slug = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/);
const styles = z.array(z.string()).max(20).transform(list => [...new Set(list.flatMap(item => item.split(',')).filter(Boolean))])
  .pipe(z.array(slug).max(20));
const integer = (min: number, max: number) => z.string().regex(/^\d{1,4}$/).transform(Number).pipe(z.number().int().min(min).max(max));
type Range = {from?: string; to?: string};
// Upcoming window: never starts in the past, defaults to the next 7 days, spans at most a year. A date-only `to` includes that day.
export function eventWindow({from, to}: Range, now = new Date()): {from: Date; to: Date} | null {
  const requested = from ? new Date(from) : now, start = requested > now ? requested : now;
  const end = to ? new Date(new Date(to).getTime() + (dateOnly.test(to) ? DAY : 0)) : new Date(start.getTime() + 7 * DAY);
  return end > start && end.getTime() - start.getTime() <= 366 * DAY ? {from: start, to: end} : null;
}
function withWindow<T extends Range>(value: T, ctx: z.RefinementCtx) {
  const range = eventWindow(value);
  if (!range) { ctx.addIssue({code: 'custom', message: 'Invalid date range', path: ['to']}); return z.NEVER; }
  return {...value, ...range};
}
export const nearbySchema = z.object({
  lat: latitude, lng: longitude,
  radiusKm: decimal.pipe(z.number().min(0.1).max(200)).optional().transform(value => value ?? 25),
  style: styles, from: instant.optional(), to: instant.optional(),
  limit: integer(50, 500).optional().transform(value => value ?? 100)
}).transform(withWindow);
export type NearbyParams = z.infer<typeof nearbySchema>;
export const bboxSchema = z.object({
  bbox: z.string().max(120).transform(value => value.split(',')).pipe(z.tuple([longitude, latitude, longitude, latitude]))
    .refine(([, south, , north]) => south < north),
  style: styles, from: instant.optional(), to: instant.optional(),
  limit: integer(1, 2000).optional().transform(value => value ?? 1000)
}).transform(withWindow);
export type BboxParams = z.infer<typeof bboxSchema>;
export const searchSchema = z.object({
  q: z.string().trim().min(3).max(200), cityId: slug.optional(),
  lang: z.enum(['en', 'es', 'ru']).optional(), mode: z.enum(['search', 'suggest']).optional()
});
export const reverseSchema = z.object({lat: latitude, lng: longitude, lang: z.enum(['en', 'es', 'ru']).optional()});
export const locateSchema = z.object({lat: latitude.optional(), lng: longitude.optional()})
  .refine(value => (value.lat === undefined) === (value.lng === undefined));
export const venueListSchema = z.object({cityId: slug.optional(), q: z.string().trim().max(100).optional()});
export const venueSchema = z.object({
  name: z.string().trim().min(2).max(120), address: z.string().trim().max(300).optional(),
  cityId: z.string().min(1).max(60), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(),
  lang: z.enum(['en', 'es', 'ru']).optional()
}).refine(value => (value.lat === undefined) === (value.lng === undefined))
  .refine(value => value.lat !== undefined || !!value.address);
// Missing parameters must be undefined, not null; `style` may repeat.
export function queryObject(request: Request): Record<string, string | string[]> {
  const params = new URL(request.url).searchParams;
  return {...Object.fromEntries(params), style: params.getAll('style')};
}
