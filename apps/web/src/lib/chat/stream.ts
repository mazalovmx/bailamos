import {conversationChannel, profileChannel, subscribe, touchPresence, type Subscription} from './realtime';
import {conversationIds, type Me} from './service';
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
  // Membership is re-read from the database whenever it may have changed, so a removed member stops receiving at once.
  const sync = async () => {
    if (!subscription || closed) return;
    const wanted = new Set((await conversationIds(me.profileId)).map(conversationChannel));
    for (const channel of subscription.channels()) if (channel.startsWith('chat:c:') && !wanted.has(channel)) await subscription.remove(channel);
    for (const channel of wanted) await subscription.add(channel);
  };
  const listener = (event: ChatEvent) => {
    if (event.type === 'conversation') void sync().catch(() => close());
    send('event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n');
  };
  const body = new ReadableStream<Uint8Array>({start(value) {controller = value;}, cancel() {void close();}});
  subscription = await subscribe([profileChannel(me.profileId), ...(await conversationIds(me.profileId)).map(conversationChannel)], listener, onAbort);
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
