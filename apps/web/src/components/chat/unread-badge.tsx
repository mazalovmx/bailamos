'use client';
import {useEffect, useState} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useLocale, useTranslations} from 'next-intl';
import type {ChatUnread} from '../../lib/chat/types';
import '../../app/styles/chat.css';
// Header link to the inbox with the number of unread messages plus waiting requests. Renders nothing for signed-out visitors.
export function UnreadBadge({signedIn = true, refreshMs = 60_000}: {signedIn?: boolean; refreshMs?: number}) {
  const t = useTranslations('Chat'), locale = useLocale(), path = usePathname();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!signedIn) return;
    let stopped = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch('/api/chat/unread', {cache: 'no-store'});
        if (!response.ok) return;
        const data = await response.json() as ChatUnread;
        if (!stopped) setCount(data.total + data.requests);
      } catch {/* the badge is a hint; a failed refresh keeps the previous number */}
    };
    void load();
    const timer = setInterval(load, refreshMs);
    document.addEventListener('visibilitychange', load);
    return () => {stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', load);};
    // The path is a dependency so that the number refreshes after reading a conversation and navigating away.
  }, [signedIn, refreshMs, path]);
  if (!signedIn) return null;
  return <Link className="chat-nav-link" href={'/' + locale + '/messages'}>
    {t('navMessages')}
    {count > 0 && <span className="chat-badge"><span aria-hidden="true">{count > 99 ? '99+' : count}</span><span className="sr-only">{t('unreadCount', {count})}</span></span>}
  </Link>;
}
