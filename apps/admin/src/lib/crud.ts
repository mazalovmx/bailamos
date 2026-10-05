// Generic Prisma-backed CRUD for the whitelisted resources. Every write and its AuditLog row share one transaction.
import {db, Prisma, changeEventStatus, lockEvent, type EventStatus} from '@dance/db';
import {HttpError} from './errors';
import type {Staff} from './guard';
import {audit, deleteTarget} from './moderation';
import {allows, inputSchema, listArgs, resource, selectOf, wouldCycle, type Access, type Resource} from './resources';
type Row = Record<string, unknown> & {id: string};
type Delegate = {
  findMany(args: unknown): Promise<Row[]>; count(args: unknown): Promise<number>; findUnique(args: unknown): Promise<Row | null>;
  create(args: unknown): Promise<Row>; update(args: unknown): Promise<Row>; delete(args: unknown): Promise<Row>;
};
type Client = Prisma.TransactionClient;
const delegate = (client: Client, item: Resource) => (client as unknown as Record<string, Delegate>)[item.model];
const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
export function permit(access: Access | undefined, user: Staff) {
  if (!access) throw new HttpError('READ_ONLY', 405);
  if (!allows(access, user.role)) throw new HttpError('ADMIN_ONLY', 403);
}
// Replaces bare foreign keys with something readable (city name, user email, …) using the referenced resource's label column.
async function withLabels(item: Resource, rows: Row[]) {
  const maps = await Promise.all(item.fields.filter(entry => entry.ref).map(async entry => {
    const target = resource(entry.ref as string);
    const ids = [...new Set(rows.map(row => row[entry.name]).filter((value): value is string => typeof value === 'string'))];
    const found = ids.length ? await delegate(db, target).findMany({where: {id: {in: ids}}, select: {id: true, [target.label]: true}}) : [];
    return [entry.name, new Map(found.map(row => [row.id, String(row[target.label] ?? row.id)]))] as const;
  }));
  return rows.map(row => ({...row, _labels: Object.fromEntries(maps.flatMap(([name, map]) => {
    const label = map.get(row[name] as string);
    return label ? [[name, label]] : [];
  }))}));
}
export async function list(item: Resource, params: URLSearchParams) {
  const args = listArgs(item, params);
  const [rows, total] = await Promise.all([delegate(db, item).findMany(args), delegate(db, item).count({where: args.where})]);
  return {data: await withLabels(item, rows), total};
}
export async function one(item: Resource, id: string) {
  const row = await delegate(db, item).findUnique({where: {id}, select: selectOf(item)});
  if (!row) throw new HttpError('NOT_FOUND', 404);
  return (await withLabels(item, [row]))[0];
}
async function check(tx: Client, item: Resource, data: Record<string, unknown>, id?: string) {
  if (typeof data.timezone === 'string') {
    try {new Intl.DateTimeFormat('en', {timeZone: data.timezone});} catch {throw new HttpError('INVALID_TIMEZONE', 400);}
  }
  for (const entry of item.fields) {
    const value = data[entry.name];
    if (!entry.ref || typeof value !== 'string') continue;
    if (!await delegate(tx, resource(entry.ref)).count({where: {id: value}})) throw new HttpError('INVALID_REFERENCE', 400);
  }
  if (item.tree && id && typeof data.parentId === 'string' && await wouldCycle(id, data.parentId,
    async current => (await delegate(tx, item).findUnique({where: {id: current}, select: {id: true, parentId: true}}))?.parentId as string | null | undefined))
    throw new HttpError('CYCLE', 400);
}
export async function create(item: Resource, input: unknown, user: Staff) {
  permit(item.create, user);
  const data = inputSchema(item, 'create').parse(input) as Record<string, unknown>;
  return db.$transaction(async tx => {
    await check(tx, item, data);
    // Catalogue entries are addressed by slug across the app (seeded as id = slug), so new ones follow the same rule.
    const row = await delegate(tx, item).create({data: item.idFromSlug ? {...data, id: data.slug} : data, select: selectOf(item)});
    await audit(tx, user.id, 'RECORD_CREATE', item.modelName, row.id, {values: plain(data)});
    return row;
  });
}
export async function update(item: Resource, id: string, input: unknown, user: Staff) {
  permit(item.update, user);
  const data = inputSchema(item, 'update').parse(input) as Record<string, unknown>;
  const keys = Object.keys(data).filter(key => data[key] !== undefined);
  if (!keys.length) throw new HttpError('INVALID_INPUT', 400);
  return db.$transaction(async tx => {
    if(item.model==='event')await lockEvent(tx,id);
    const before = await delegate(tx, item).findUnique({where: {id}, select: {id: true, ...Object.fromEntries(keys.map(key => [key, true]))}});
    if (!before) throw new HttpError('NOT_FOUND', 404);
    await check(tx, item, data, id);
    if(item.model==='event'&&typeof data.status==='string')await changeEventStatus(tx,id,data.status as EventStatus,user.id);
    const {status,...other}=data;
    const updateData=item.model==='event'?{...other,version:{increment:1}}:{...other,...(status!==undefined?{status}:{})};
    const row = await delegate(tx, item).update({where: {id}, data:updateData, select: selectOf(item)});
    const was = plain(before), now = plain(row), changed = keys.filter(key => JSON.stringify(was[key]) !== JSON.stringify(now[key]));
    if (changed.length) await audit(tx, user.id, 'RECORD_UPDATE', item.modelName, id,
      {before: Object.fromEntries(changed.map(key => [key, was[key] ?? null])), after: Object.fromEntries(changed.map(key => [key, now[key] ?? null]))});
    return row;
  });
}
export async function remove(item: Resource, id: string, user: Staff, reason: string | null) {
  permit(item.remove, user);
  // User content goes through the moderation action, which demands a reason and keeps a snapshot.
  if (item.hide) {
    if (!reason) throw new HttpError('REASON_REQUIRED', 400);
    await deleteTarget(item.hide, id, user.id, reason);
    return {id};
  }
  return db.$transaction(async tx => {
    const before = await delegate(tx, item).findUnique({where: {id}, select: selectOf(item)});
    if (!before) throw new HttpError('NOT_FOUND', 404);
    await delegate(tx, item).delete({where: {id}});
    await audit(tx, user.id, 'RECORD_DELETE', item.modelName, id, {reason, values: plain(before)});
    return {id};
  });
}
