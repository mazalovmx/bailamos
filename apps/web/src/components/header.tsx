'use client';
import {usePathname, useRouter} from 'next/navigation';
import {useTranslations, useLocale} from 'next-intl';
import {useEffect, useRef, useState} from 'react';
import {UnreadBadge} from './chat/unread-badge';
import {SearchBox} from './search/search-box';
import {NotificationBell} from './notifications/bell';
import {signOutCleanup} from './pwa/worker';
import '../app/header.css';
const locales = ['en', 'es', 'ru'];
// One row: brand, five main sections, "More", search, account and language. Everything else lives in the menus,
// which are plain <details> elements — they work without JavaScript; the script only closes them politely.
export function Header({signedIn, adminUrl}: {signedIn: boolean; adminUrl?: string}) {
  const t = useTranslations('App'), locale = useLocale(), path = usePathname(), router = useRouter();
  const calendar = useTranslations('Calendar'), geo = useTranslations('Geo'), catalogue = useTranslations('Catalogue'), account = useTranslations('Account');
  const feed = useTranslations('Feed'), matching = useTranslations('Matching'), blog = useTranslations('Blog');
  const [busy, setBusy] = useState(false), root = useRef<HTMLElement>(null), base = '/' + locale;
  const closeAll = (except?: Element | null) => root.current?.querySelectorAll('details[open]').forEach(menu => {if (menu !== except) (menu as HTMLDetailsElement).open = false;});
  useEffect(() => {
    const outside = (event: MouseEvent) => {if (!root.current?.contains(event.target as Node)) closeAll();};
    document.addEventListener('click', outside);
    return () => document.removeEventListener('click', outside);
  }, []);
  // Menus close when the page changes.
  useEffect(() => {closeAll();}, [path]);
  async function signOut() {
    setBusy(true);
    try {
      await signOutCleanup().catch(() => undefined);
      const response = await fetch('/api/auth/sign-out', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
      if (response.ok) {router.push(base); router.refresh();}
    } finally {setBusy(false);}
  }
  const current = (href: string) => path === href || path.startsWith(href + '/') ? 'page' as const : undefined;
  const link = (href: string, label: string) => <a key={href} href={base + href} aria-current={current(base + href)}>{label}</a>;
  const primary = [link('/events', t('events')), link('/calendar', calendar('title')), link('/map', geo('mapEyebrow')), link('/classes', t('homeKindClasses')), link('/schools', t('homeKindSchools'))];
  const more = [link('/cities', catalogue('citiesTitle')), link('/styles', catalogue('stylesTitle')), link('/feed', feed('title')), link('/share', t('announcement'))];
  const personal = [link('/account', t('accountHome')), link('/my-events', t('myEvents')), link('/profile', t('profile')), link('/partners', matching('title')),
    link('/posts', blog('myPostsTitle')), link('/settings', account('settingsTitle'))];
  const menu = (name: string, label: React.ReactNode, items: React.ReactNode) => <details className={'site-menu site-menu-' + name}
    onToggle={event => {if (event.currentTarget.open) closeAll(event.currentTarget);}}><summary>{label} <span aria-hidden="true">▾</span></summary><div className="site-menu-panel">{items}</div></details>;
  const languageHref = (code: string) => path.replace(/^\/(en|es|ru)(?=\/|$)/, '/' + code);
  return <header ref={root} className="app-header site-header" onKeyDown={event => {
    if (event.key !== 'Escape') return;
    const open = (event.target as Element).closest('details[open]') as HTMLDetailsElement | null;
    if (open) {open.open = false; open.querySelector('summary')?.focus();}
  }}>
    <a className="brand" href={base}>dance<span>community</span></a>
    <nav className="site-nav" aria-label={t('navigation')}>{primary}{menu('more', t('navMore'), more)}</nav>
    <SearchBox/>
    <div className="site-tools">
      {signedIn ? <><UnreadBadge signedIn/><NotificationBell/>
        {menu('account', t('accountHome'), <>{personal}{adminUrl && <a href={adminUrl}>{t('adminPanel')} <span aria-hidden="true">↗</span></a>}
          <button type="button" disabled={busy} onClick={signOut}>{t('signOut')}</button></>)}</> : <a className="site-signin" href={base + '/login'}>{t('signIn')}</a>}
      {menu('language', <><span className="sr-only">{t('language')}: </span>{locale.toUpperCase()}</>, locales.map(code =>
        <a key={code} href={languageHref(code)} lang={code} hrefLang={code} aria-current={code === locale ? 'true' : undefined}
          onClick={event => {event.preventDefault(); window.location.href = languageHref(code) + window.location.search;}}>{code.toUpperCase()}</a>))}
      {/* Narrow screens: every section and personal link in one menu. */}
      {menu('all', <>{t('openMenu')} <span aria-hidden="true">☰</span></>, <>{primary}{more}{signedIn && <>{personal}
        {adminUrl && <a href={adminUrl}>{t('adminPanel')} <span aria-hidden="true">↗</span></a>}<button type="button" disabled={busy} onClick={signOut}>{t('signOut')}</button></>}</>)}
    </div>
  </header>;
}
