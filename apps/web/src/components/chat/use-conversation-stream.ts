'use client';
import {useEffect, useRef, useState} from 'react';
import type {ChatEvent} from '../../lib/chat/types';
export type StreamMode = 'connecting' | 'live' | 'polling';
type Options = {
  /** Only events of this conversation are delivered; without it every event of the viewer's conversations is. */
  conversationId?: string;
  onEvent: (event: ChatEvent) => void;
  /** Fetches whatever was missed. Runs on every (re)connect, on an interval while the stream is down and when the tab becomes visible. */
  poll: () => Promise<void>;
  pollMs?: number;
};
const eventTypes = ['message', 'hidden', 'conversation'] as const;
/**
 * Live updates over Server-Sent Events with an automatic fallback: when the stream cannot be opened or drops (no Redis, a proxy
 * that buffers, offline), the hook polls every `pollMs` and keeps retrying the stream with exponential backoff up to one minute.
 */
export function useConversationStream({conversationId, onEvent, poll, pollMs = 5000}: Options): StreamMode {
  const [mode, setMode] = useState<StreamMode>('connecting');
  const handlers = useRef({onEvent, poll});
  useEffect(() => {handlers.current = {onEvent, poll};});
  useEffect(() => {
    let source: EventSource | null = null, stopped = false, attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined, pollTimer: ReturnType<typeof setInterval> | undefined;
    const runPoll = () => {if (!document.hidden) void handlers.current.poll().catch(() => undefined);};
    const startPolling = () => {
      setMode('polling');
      pollTimer ??= setInterval(runPoll, pollMs);
    };
    const stopPolling = () => {clearInterval(pollTimer); pollTimer = undefined;};
    const connect = () => {
      if (stopped) return;
      if (typeof EventSource === 'undefined') {startPolling(); return;}
      const stream = source = new EventSource('/api/chat/stream');
      stream.addEventListener('ready', () => {
        attempt = 0;
        stopPolling();
        setMode('live');
        // Anything sent between the last poll and the subscription is picked up here.
        runPoll();
      });
      for (const type of eventTypes) stream.addEventListener(type, message => {
        try {
          const event = JSON.parse((message as MessageEvent<string>).data) as ChatEvent;
          if (!conversationId || event.conversationId === conversationId) handlers.current.onEvent(event);
        } catch {/* a malformed frame is ignored; the next poll repairs the state */}
      });
      stream.onerror = () => {
        // EventSource would retry on its own only for network errors; closing it puts every failure on the same backoff.
        stream.close();
        if (source === stream) source = null;
        if (stopped) return;
        startPolling();
        runPoll();
        const delay = Math.min(60_000, 2000 * 2 ** attempt++) + Math.random() * 1000;
        clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, delay);
      };
    };
    const onVisible = () => {if (!document.hidden) runPoll();};
    const onOnline = () => {
      if (source || stopped) return;
      attempt = 0;
      clearTimeout(retryTimer);
      connect();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    connect();
    return () => {
      stopped = true;
      source?.close();
      clearTimeout(retryTimer);
      stopPolling();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [conversationId, pollMs]);
  return mode;
}
