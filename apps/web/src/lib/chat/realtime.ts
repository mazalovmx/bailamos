import Redis from 'ioredis';
import {withRedis} from '../redis';
import type {ChatEvent} from './types';
// Realtime fan-out. Every Node process publishes to Redis and keeps ONE dedicated subscriber connection shared by all of its
// SSE responses, so a message written by process A reaches streams held by process B. Without Redis nothing here throws:
// subscribe() resolves to null, the stream endpoint answers 503 and clients fall back to polling.
export const conversationChannel = (id: string) => 'chat:c:' + id;
export const profileChannel = (id: string) => 'chat:p:' + id;
type Listener = (event: ChatEvent) => void;
type Hub = {redis?: Redis; ready?: Promise<Redis | null>; channels: Map<string, Set<Listener>>; down: Set<() => void>};
const holder = globalThis as unknown as {danceChatHub?: Hub};
const hub: Hub = holder.danceChatHub ??= {channels: new Map<string, Set<Listener>>(), down: new Set<() => void>()};
function drop(redis: Redis) {
  if (hub.redis !== redis) return;
  hub.redis = undefined; hub.ready = undefined;
  redis.disconnect();
  hub.channels.clear();
  // Messages published while the connection was down are lost, so every stream is closed and its client catches up by polling.
  for (const notify of [...hub.down]) notify();
}
function subscriber(): Promise<Redis | null> {
  const url = process.env.REDIS_URL;
  if (!url) return Promise.resolve(null);
  if (hub.redis && hub.ready) return hub.ready;
  const redis = new Redis(url, {lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 1500, retryStrategy: () => null});
  hub.redis = redis;
  redis.on('error', () => {});
  redis.on('message', (channel: string, payload: string) => {
    const listeners = hub.channels.get(channel);
    if (!listeners?.size) return;
    let event: ChatEvent;
    try {event = JSON.parse(payload) as ChatEvent;} catch {return;}
    for (const listener of [...listeners]) try {listener(event);} catch {/* one broken stream must not stop the others */}
  });
  redis.on('close', () => drop(redis));
  redis.on('end', () => drop(redis));
  return hub.ready = redis.connect().then(() => redis, () => {drop(redis); return null;});
}
export type Subscription = {add(channel: string): Promise<boolean>; remove(channel: string): Promise<void>; close(): Promise<void>; channels(): string[]};
/** Subscribes `listener` to the channels. Resolves to null when Redis is unavailable. `onDown` fires if the connection is lost later. */
export async function subscribe(channels: string[], listener: Listener, onDown: () => void): Promise<Subscription | null> {
  const redis = await subscriber();
  if (!redis) return null;
  const mine = new Set<string>();
  let closed = false;
  const add = async (channel: string) => {
    if (closed || hub.redis !== redis) return false;
    if (mine.has(channel)) return true;
    let listeners = hub.channels.get(channel);
    const first = !listeners;
    if (!listeners) hub.channels.set(channel, listeners = new Set());
    listeners.add(listener); mine.add(channel);
    if (first) try {await redis.subscribe(channel);} catch {await remove(channel); return false;}
    return true;
  };
  const remove = async (channel: string) => {
    if (!mine.delete(channel)) return;
    const listeners = hub.channels.get(channel);
    if (!listeners) return;
    listeners.delete(listener);
    if (listeners.size) return;
    hub.channels.delete(channel);
    if (hub.redis === redis) await redis.unsubscribe(channel).catch(() => undefined);
  };
  const close = async () => {
    closed = true; hub.down.delete(onDown);
    await Promise.all([...mine].map(remove));
  };
  hub.down.add(onDown);
  for (const channel of channels) if (!await add(channel)) {await close(); return null;}
  return {add, remove, close, channels: () => [...mine]};
}
/** Best effort: resolves to false when the event could not be published (clients then see it on their next poll). */
export async function publish(channel: string, event: ChatEvent) {
  return (await withRedis(redis => redis.publish(channel, JSON.stringify(event)))) !== undefined;
}
// Presence: a short-lived key refreshed by the stream heartbeat. It is never deleted on disconnect because another tab may still be open.
const presenceKey = (profileId: string) => 'chat:on:' + profileId;
export const PRESENCE_TTL = 50;
export async function touchPresence(profileId: string) {
  await withRedis(redis => redis.set(presenceKey(profileId), '1', 'EX', PRESENCE_TTL));
}
/** Profile ids currently connected to the stream. Empty when Redis is unavailable, so everybody gets a notification. */
export async function onlineProfiles(profileIds: string[]) {
  if (!profileIds.length) return new Set<string>();
  const found = await withRedis(redis => redis.mget(profileIds.map(presenceKey)));
  return new Set(profileIds.filter((_, index) => found?.[index]));
}
// Burst guard for notifications; the durable rule ("one unread notification per conversation") is checked in the database.
const notifyKey = (conversationId: string, userId: string) => 'chat:n:' + conversationId + ':' + userId;
export async function claimNotification(conversationId: string, userId: string) {
  const result = await withRedis(redis => redis.set(notifyKey(conversationId, userId), '1', 'EX', 30, 'NX'));
  return result !== null;
}
export async function releaseNotification(conversationId: string, userId: string) {
  await withRedis(redis => redis.del(notifyKey(conversationId, userId)));
}
/** Test helper: closes the subscriber connection so the process can exit. */
export async function closeChatRealtime() {
  const redis = hub.redis;
  hub.redis = undefined; hub.ready = undefined; hub.channels.clear(); hub.down.clear();
  redis?.disconnect();
}
