import {conversationChannel, profileChannel, subscribe, touchPresence, type Subscription} from './realtime';
import {blockedByMe, conversationIds, type Me} from './service';
import type {ChatEvent} from './types';
export const HEARTBEAT_MS = 20_000;
const RECHECK_EVERY = 3, MAX_BEATS = 90;
/**
 * Server-Sent Events for one member: events of the conversations they belong to and nothing else.
 * Resolves to null when Redis pub/sub is unavailable; the route then answers 503 and the client polls instead.
 * `recheck` re-validates the session (sign-out, ban) once a minute; a failed check ends the stream.
 */
export async function chatStream(me: Me, signal: AbortSignal, recheck: () => Promise<boolean>, heartbeatMs = HEARTBEAT_MS): Promise<Response | null> {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = false, beats = 0, subscription: Subscription | null = null;
  const timers: {beat?: ReturnType<typeof setInterval>} = {};
  const close = async () => {
    if (closed) return;
    closed = true;
    clearInterval(timers.beat);
    signal.removeEventListener('abort', onAbort);
    await subscription?.close().catch(() => undefined);
    try {controller?.close();} catch {/* already closed by the client */}
  };
  const onAbort = () => {void close();};
  const send = (text: string) => {
    if (closed) return;
    try {controller?.enqueue(encoder.encode(text));} catch {void close();}
  };
  let blocked = await blockedByMe(me.profileId);
  // Membership (own conversations and those of managed schools) and the reader's block list are re-read from the database
  // whenever they may have changed, so a removed member or a manager whose grant was revoked stops receiving at once.
  const sync = async () => {
    if (!subscription || closed) return;
    const [ids, blocks] = await Promise.all([conversationIds(me), blockedByMe(me.profileId)]);
    blocked = blocks;
    const wanted = new Set(ids.map(conversationChannel));
    for (const channel of subscription.channels()) if (channel.startsWith('chat:c:') && !wanted.has(channel)) await subscription.remove(channel);
    for (const channel of wanted) await subscription.add(channel);
  };
  const listener = (event: ChatEvent) => {
    // Every member receives the same event from Redis; what depends on the reader (a sender they blocked) is marked here.
    const own = (event.type === 'message' || event.type === 'edited') && blocked.has(event.message.sender.id)
      ? {...event, message: {...event.message, blockedSender: true}} : event;
    const frame = 'event: ' + own.type + '\ndata: ' + JSON.stringify(own) + '\n\n';
    // A membership change is announced only after the subscriptions follow it, so the client can rely on what comes next.
    if (event.type === 'conversation') void sync().then(() => send(frame), () => close()); else send(frame);
  };
  const body = new ReadableStream<Uint8Array>({start(value) {controller = value;}, cancel() {void close();}});
  subscription = await subscribe([profileChannel(me.profileId), ...(await conversationIds(me)).map(conversationChannel)], listener, onAbort);
  if (!subscription) {closed = true; return null;}
  if (signal.aborted) {await close(); return null;}
  signal.addEventListener('abort', onAbort);
  await touchPresence(me.profileId);
  send('retry: 3000\n\nevent: ready\ndata: {}\n\n');
  timers.beat = setInterval(() => {
    beats++;
    send(': ping\n\n');
    void touchPresence(me.profileId);
    // Long-lived streams are cut after half an hour; the client reconnects and authenticates again.
    if (beats >= MAX_BEATS) {void close(); return;}
    if (beats % RECHECK_EVERY === 0) void recheck().then(ok => ok ? sync() : close()).catch(() => close());
  }, heartbeatMs);
  return new Response(body, {headers: {'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no'}});
}
