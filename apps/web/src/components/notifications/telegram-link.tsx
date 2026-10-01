'use client';
import {useEffect, useState} from 'react';
import {useTranslations} from 'next-intl';
// Connects the signed-in account to the Telegram bot. Renders nothing when the bot is not configured.
export function TelegramLink() {
  const t = useTranslations('Notifications');
  const [state, setState] = useState<{enabled: boolean; linked: boolean} | null>(null), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const load = () => fetch('/api/telegram/link').then(r => r.ok ? r.json() : null).then(setState).catch(() => setState(null));
  useEffect(() => {void load();}, []);
  if (!state?.enabled) return null;
  async function call(method: 'POST' | 'DELETE') {
    setBusy(true); setFailed(false);
    try {
      const response = await fetch('/api/telegram/link', {method});
      if (!response.ok) throw new Error('failed');
      const data = await response.json();
      // The one-time link opens the bot; the chat is bound when the user presses Start there.
      if (method === 'POST' && typeof data.url === 'string') window.open(data.url, '_blank', 'noopener');
      await load();
    } catch {setFailed(true);} finally {setBusy(false);}
  }
  return <section className="account-section" aria-labelledby="telegram-title"><h2 id="telegram-title">{t('telegramTitle')}</h2>
    <p>{t(state.linked ? 'telegramConnected' : 'telegramHint')}</p>
    <button type="button" className="button secondary" disabled={busy} onClick={() => call(state.linked ? 'DELETE' : 'POST')}>
      {t(state.linked ? 'telegramDisconnect' : 'telegramConnect')}</button>
    {/* After connecting in Telegram the state changes there, so the user can re-check without reloading. */}
    {failed && <p role="alert" className="form-error">{t('telegramFailed')}</p>}
  </section>;
}
