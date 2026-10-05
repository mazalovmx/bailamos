// The whitelist behind the generic REST handlers: a column that is not listed here can be neither read nor written,
// and a model that is not listed here (Session, Account, Verification, PushSubscription, …) is not reachable at all.
import {z} from 'zod';
import {AttendeeVisibility, ClaimStatus, ConversationKind, DanceFormat, EventKind, EventLevel, EventStatus, ImportKind, ImportStatus,
  Intensity, MusicTempo, ProfileType, ReportReason, ReportStatus, ReportTarget, UserRole} from '@dance/db';
import {HttpError} from './errors';
import type {TargetType} from './moderation';
export type Access = 'STAFF' | 'ADMIN';
export type FieldType = 'string' | 'text' | 'number' | 'boolean' | 'date' | 'enum' | 'json';
export type Field = {
  name: string; type: FieldType; values?: string[]; ref?: string;
  list?: boolean; sort?: boolean; filter?: boolean; search?: boolean;
  write?: boolean; required?: boolean; nullable?: boolean;
  min?: number; max?: number; pattern?: RegExp;
};
export type Resource = {
  name: string; model: string; modelName: string; label: string; fields: Field[];
  create?: Access; update?: Access; remove?: Access;
  hide?: TargetType; sort: [string, 'asc' | 'desc']; tree?: boolean; idFromSlug?: boolean;
};
type Flags = Partial<Omit<Field, 'name' | 'type'>>;
const L: Flags = {list: true}, S: Flags = {sort: true}, F: Flags = {filter: true}, Q: Flags = {search: true},
  W: Flags = {write: true}, R: Flags = {required: true}, N: Flags = {nullable: true};
const field = (name: string, type: FieldType, ...flags: Flags[]): Field => Object.assign({name, type}, ...flags);
const str = (name: string, ...flags: Flags[]) => field(name, 'string', ...flags);
const text = (name: string, ...flags: Flags[]) => field(name, 'text', ...flags);
const date = (name: string, ...flags: Flags[]) => field(name, 'date', ...flags);
const bool = (name: string, ...flags: Flags[]) => field(name, 'boolean', ...flags);
const num = (name: string, ...flags: Flags[]) => field(name, 'number', ...flags);
const pick = (name: string, values: Record<string, string>, ...flags: Flags[]) => field(name, 'enum', {values: Object.values(values)}, ...flags);
const ref = (name: string, resource: string, ...flags: Flags[]) => field(name, 'string', {ref: resource}, ...flags);
const id = str('id', F), created = date('createdAt', L, S, F), hidden = date('hiddenAt', L, F, N);
const slug = {pattern: /^[a-z0-9][a-z0-9-]*$/, max: 80}, lat = {min: -90, max: 90}, lng = {min: -180, max: 180};
export const resources: Resource[] = [
  // Events are created in the web app, which also materialises occurrences; schedule and city stay read-only here.
  {name: 'events', model: 'event', modelName: 'Event', label: 'title', update: 'STAFF', remove: 'STAFF', hide: 'EVENT', sort: ['createdAt', 'desc'], fields: [
    id, str('slug', Q), str('shortCode', N), str('title', L, S, Q, W, R, {max: 200}), text('description', W, N), date('startsAt', L, S, F), date('endsAt', N),
    str('timezone'), str('rrule', N), ref('cityId', 'cities', L, F), ref('venueId', 'venues', N, F),
    pick('status', EventStatus, L, F, W), pick('kind', EventKind, L, F, W), pick('format', DanceFormat, F, W), pick('level', EventLevel, F, W),
    pick('intensity', Intensity, W), pick('tempo', MusicTempo, W), text('prerequisites', W, N), bool('partnerRequired', W, N),
    str('priceText', W, N, {max: 200}), pick('attendeeVisibility', AttendeeVisibility, W), str('sourceUrl', W, N, {max: 2000}),
    hidden, created, date('updatedAt')]},
  // Exact coordinates of a person are never exposed, not even to staff. Ownership (userId) changes only through claims.
  {name: 'profiles', model: 'profile', modelName: 'Profile', label: 'name', create: 'STAFF', update: 'STAFF', remove: 'STAFF', hide: 'PROFILE', sort: ['createdAt', 'desc'], fields: [
    id, pick('type', ProfileType, L, F, W, R), str('handle', L, S, Q, W, R, {pattern: /^[a-z0-9][a-z0-9_-]*$/, min: 3, max: 30}),
    str('name', L, S, Q, W, R, {min: 2, max: 80}), text('bio', W, N, {max: 1000}), str('instagram', W, N, {max: 100}),
    ref('userId', 'users', L, F, N), ref('cityId', 'cities', L, F, W, N), str('district', W, N, {max: 100}),
    str('avatarKey', N), str('coverKey', N), hidden, date('lastActiveAt', N), created, date('updatedAt')]},
  {name: 'venues', model: 'venue', modelName: 'Venue', label: 'name', create: 'STAFF', update: 'STAFF', remove: 'STAFF', hide: 'VENUE', sort: ['createdAt', 'desc'], fields: [
    id, str('name', L, S, Q, W, R, {max: 200}), str('address', L, Q, W, R, {max: 300}), ref('cityId', 'cities', L, F, W, R),
    num('lat', W, R, lat), num('lng', W, R, lng), hidden, created]},
  {name: 'cities', model: 'city', modelName: 'City', label: 'name', create: 'STAFF', update: 'STAFF', remove: 'ADMIN', sort: ['name', 'asc'], idFromSlug: true, fields: [
    id, str('slug', L, S, Q, W, R, slug), str('name', L, S, Q, W, R, {max: 120}), str('countryCode', L, S, F, W, R, {pattern: /^[A-Z]{2}$/}),
    str('timezone', L, W, R, {max: 64}), num('lat', W, R, lat), num('lng', W, R, lng)]},
  {name: 'styles', model: 'danceStyle', modelName: 'DanceStyle', label: 'name', create: 'STAFF', update: 'STAFF', remove: 'ADMIN', sort: ['name', 'asc'], tree: true, idFromSlug: true, fields: [
    id, str('slug', L, S, Q, W, R, slug), str('name', L, S, Q, W, R, {max: 120}), ref('parentId', 'styles', L, F, W, N)]},
  {name: 'posts', model: 'post', modelName: 'Post', label: 'title', update: 'STAFF', remove: 'STAFF', hide: 'POST', sort: ['createdAt', 'desc'], fields: [
    id, str('slug', N, Q), str('title', L, S, Q, W, R, {max: 200}), text('excerpt', W, N, {max: 1000}), field('content', 'json'),
    ref('profileId', 'profiles', L, F), ref('eventId', 'events', F, N), date('publishedAt', L, S, N), hidden, created, date('updatedAt')]},
  // embedHtml is third-party markup and is deliberately not exposed: the panel never renders it.
  {name: 'media', model: 'mediaItem', modelName: 'MediaItem', label: 'kind', update: 'STAFF', remove: 'STAFF', hide: 'MEDIA', sort: ['createdAt', 'desc'], fields: [
    id, str('kind', L, F), str('storageKey', L, N), str('alt', L, W, N, Q, {max: 500}), str('mime', N), num('size', N), num('width', N), num('height', N),
    num('position'), str('sourceUrl', L, N, Q), ref('uploaderProfileId', 'profiles', L, F, N), ref('postId', 'posts', F, N), ref('eventId', 'events', F, N),
    hidden, created]},
  // Read-only: bans and roles go through dedicated, audited actions.
  {name: 'users', model: 'user', modelName: 'User', label: 'email', sort: ['createdAt', 'desc'], fields: [
    id, str('name', L, S, Q), str('email', L, S, Q), bool('emailVerified', L, F), bool('ageConfirmed'), str('locale', F),
    pick('role', UserRole, L, F), date('bannedAt', L, F, N), str('banReason', N), created, date('updatedAt')]},
  {name: 'conversations', model: 'conversation', modelName: 'Conversation', label: 'title', sort: ['updatedAt', 'desc'], fields: [
    id, pick('kind', ConversationKind, L, F), str('title', L, Q, N), ref('eventId', 'events', L, F, N), ref('cityId', 'cities', L, F, N),
    created, date('updatedAt', L, S)]},
  {name: 'messages', model: 'message', modelName: 'Message', label: 'id', remove: 'STAFF', hide: 'MESSAGE', sort: ['createdAt', 'desc'], fields: [
    id, ref('conversationId', 'conversations', L, F), ref('senderProfileId', 'profiles', L, F), text('body', L, Q), hidden, created]},
  {name: 'reports', model: 'report', modelName: 'Report', label: 'id', sort: ['createdAt', 'desc'], fields: [
    id, pick('status', ReportStatus, L, F), pick('targetType', ReportTarget, L, F), str('targetId', L, F), pick('reason', ReportReason, L, F),
    text('comment', N), ref('reporterUserId', 'users', L, F, N), str('resolution', L, N), ref('resolvedByUserId', 'users', F, N),
    date('resolvedAt', N), created]},
  {name: 'claims', model: 'profileClaim', modelName: 'ProfileClaim', label: 'id', sort: ['createdAt', 'desc'], fields: [
    id, pick('status', ClaimStatus, L, F), ref('profileId', 'profiles', L, F), ref('userId', 'users', L, F), text('message', L, N),
    ref('decidedByUserId', 'users', F, N), date('decidedAt', N), created]},
  {name: 'import-sources', model: 'importSource', modelName: 'ImportSource', label: 'name', create: 'STAFF', update: 'STAFF', remove: 'ADMIN', sort: ['createdAt', 'desc'], fields: [
    id, str('name', L, S, Q, W, R, {max: 200}), pick('kind', ImportKind, L, F, W, R), str('url', L, Q, W, R, {pattern: /^https?:\/\/\S+$/, max: 2000}),
    ref('cityId', 'cities', L, F, W, N), bool('news', L, F, W), bool('enabled', L, F, W), date('lastRunAt', L, N), str('lastStatus', L, N), created]},
  {name: 'imported-items', model: 'importedItem', modelName: 'ImportedItem', label: 'externalId', sort: ['createdAt', 'desc'], fields: [
    id, pick('status', ImportStatus, L, F), ref('sourceId', 'import-sources', L, F), str('externalId', L, Q), str('dedupeKey', N, F),
    field('payload', 'json'), ref('eventId', 'events', L, F, N), str('note', L, N), created]},
  {name: 'audit-log', model: 'auditLog', modelName: 'AuditLog', label: 'action', sort: ['createdAt', 'desc'], fields: [
    id, created, ref('actorUserId', 'users', L, F, N), str('action', L, F, Q), str('targetType', L, F), str('targetId', L, F, N), field('data', 'json', L)]}
];
export function resource(name: string) {
  const found = resources.find(item => item.name === name);
  if (!found) throw new HttpError('NOT_FOUND', 404);
  return found;
}
export const allows = (access: Access | undefined, role: string) => !!access && ['OWNER','ADMIN','MODERATOR'].includes(role) && (access === 'STAFF' || role === 'ADMIN' || role === 'OWNER');
// Prisma `select` built only from whitelisted columns: nothing else can leave the database through the generic handlers.
export const selectOf = (item: Resource) => Object.fromEntries(item.fields.map(entry => [entry.name, true as const]));
function valueSchema(entry: Field): z.ZodType {
  if (entry.type === 'string' || entry.type === 'text') {
    let string = z.string().trim().min(entry.min ?? (entry.nullable ? 0 : 1)).max(entry.max ?? (entry.type === 'text' ? 20000 : 300));
    if (entry.pattern) string = string.regex(entry.pattern);
    // An emptied optional text field means "no value".
    return entry.nullable ? z.preprocess(value => typeof value === 'string' && !value.trim() ? null : value, string.nullable()) : string;
  }
  const schema: z.ZodType = entry.type === 'number' ? z.number().min(entry.min ?? -1e9).max(entry.max ?? 1e9)
    : entry.type === 'boolean' ? z.boolean()
    : entry.type === 'enum' ? z.enum(entry.values as [string, ...string[]])
    : z.iso.datetime({offset: true}).transform(value => new Date(value));
  return entry.nullable ? schema.nullable() : schema;
}
// Strict: an unknown or read-only key (role, bannedAt, userId, hiddenAt, id, …) is rejected instead of silently dropped.
export function inputSchema(item: Resource, mode: 'create' | 'update') {
  const shape: Record<string, z.ZodType> = {};
  for (const entry of item.fields) if (entry.write)
    shape[entry.name] = mode === 'create' && entry.required ? valueSchema(entry) : valueSchema(entry).optional();
  return z.strictObject(shape);
}
function cast(entry: Field, raw: string): string | number | boolean | Date {
  if (entry.type === 'number') {const value = Number(raw); if (raw.trim() && Number.isFinite(value)) return value;}
  else if (entry.type === 'boolean') {if (raw === 'true' || raw === 'false') return raw === 'true';}
  else if (entry.type === 'date') {const value = new Date(raw); if (!Number.isNaN(value.getTime())) return value;}
  else if (entry.type === 'enum') {if (entry.values?.includes(raw)) return raw;}
  else if (entry.type !== 'json') return raw;
  throw new HttpError('INVALID_FILTER', 400);
}
const reserved = new Set(['page', 'pageSize', 'sort', 'order', 'q']);
const operators = new Set(['eq', 'ne', 'gte', 'lte', 'contains', 'null', 'in']);
// Query string → Prisma arguments. Filters: field=value, field__ne, field__gte, field__lte, field__contains, field__in=a,b, field__null=true|false.
export function listArgs(item: Resource, params: URLSearchParams) {
  const page = Math.max(1, Math.trunc(Number(params.get('page')) || 1));
  const pageSize = Math.min(200, Math.max(1, Math.trunc(Number(params.get('pageSize')) || 25)));
  const and: Record<string, unknown>[] = [];
  for (const [key, raw] of params) {
    if (reserved.has(key)) continue;
    const [name, operator = 'eq'] = key.split('__');
    const entry = item.fields.find(candidate => candidate.name === name);
    if (!entry?.filter || !operators.has(operator)) throw new HttpError('INVALID_FILTER', 400);
    if (operator === 'null') and.push({[name]: raw === 'true' ? null : {not: null}});
    else if (operator === 'in') and.push({[name]: {in: raw.split(',').filter(Boolean).slice(0, 100).map(value => cast(entry, value))}});
    else if (operator === 'contains') {
      if (entry.type !== 'string' && entry.type !== 'text') throw new HttpError('INVALID_FILTER', 400);
      and.push({[name]: {contains: raw, mode: 'insensitive'}});
    } else if (operator === 'eq') and.push({[name]: cast(entry, raw)});
    else and.push({[name]: {[operator === 'ne' ? 'not' : operator]: cast(entry, raw)}});
  }
  const q = params.get('q')?.trim().slice(0, 200);
  if (q) and.push({OR: [{id: q}, ...item.fields.filter(entry => entry.search).map(entry => ({[entry.name]: {contains: q, mode: 'insensitive'}}))]});
  const requested = params.get('sort');
  const sortable = requested ? item.fields.find(entry => entry.name === requested && (entry.sort || entry.name === 'id')) : undefined;
  if (requested && !sortable) throw new HttpError('INVALID_SORT', 400);
  const order = params.get('order') === 'asc' ? 'asc' : params.get('order') === 'desc' ? 'desc' : undefined;
  const [sort, direction] = sortable ? [sortable.name, order ?? 'asc'] : [item.sort[0], order ?? item.sort[1]];
  return {where: and.length ? {AND: and} : {}, orderBy: [{[sort]: direction}, ...(sort === 'id' ? [] : [{id: 'asc'}])],
    skip: (page - 1) * pageSize, take: pageSize, select: selectOf(item)};
}
// True when making `parentId` the parent of `id` would close a loop in the style tree.
export async function wouldCycle(id: string, parentId: string, parentOf: (id: string) => Promise<string | null | undefined>) {
  const seen = new Set<string>();
  for (let current: string | null | undefined = parentId; current; current = await parentOf(current)) {
    if (current === id || seen.has(current)) return true;
    seen.add(current);
  }
  return false;
}
export type FieldMeta = Omit<Field, 'pattern'> & {pattern?: string};
// Browsers compile the HTML `pattern` attribute with the `v` flag, where a literal hyphen in a class must be escaped.
const htmlPattern = (pattern: RegExp) => pattern.source.replace(/-]/g, String.raw`\-]`);
export type ResourceMeta = {name: string; label: string; fields: FieldMeta[]; canCreate: boolean; canUpdate: boolean; canDelete: boolean;
  hide: string | null; tree: boolean; searchable: boolean};
// What the browser may know about a resource for this role; sent from the server so the client bundle never imports Prisma.
export const resourceMeta = (role: string): ResourceMeta[] => resources.map(item => ({
  name: item.name, label: item.label, fields: item.fields.map(({pattern, ...rest}) => ({...rest, ...(pattern ? {pattern: htmlPattern(pattern)} : {})})),
  canCreate: allows(item.create, role), canUpdate: allows(item.update, role), canDelete: allows(item.remove, role),
  hide: item.hide ?? null, tree: !!item.tree, searchable: item.fields.some(entry => entry.search)
}));
