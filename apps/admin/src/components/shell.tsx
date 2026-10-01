'use client';
import {Suspense, useMemo} from 'react';
import {Refine, type AuthProvider, type I18nProvider as RefineI18nProvider} from '@refinedev/core';
import routerProvider from '@refinedev/nextjs-router';
import Link from 'next/link';
import {usePathname, useRouter} from 'next/navigation';
import {api, dataProvider} from '../lib/data-provider';
import {LocaleSwitch, useT} from './i18n';
import {PanelContext, type Panel} from './panel';
const groups: [string, string[]][] = [
  ['content', ['events', 'profiles', 'venues', 'posts', 'media']],
  ['catalogue', ['cities', 'styles']],
  ['people', ['users', 'conversations', 'messages']],
  ['moderation', ['reports', 'claims']],
  ['import', ['import-sources', 'imported-items']],
  ['system', ['audit-log']]
];
const signOut = async () => {
  await api('/api/auth/sign-out', {method: 'POST', body: {}}).catch(() => undefined);
  window.location.assign('/login');
};
// The server layout has already verified the staff session; the provider only reacts to it ending.
const authProvider: AuthProvider = {
  login: async () => ({success: false}),
  logout: async () => {await signOut(); return {success: true};},
  check: async () => ({authenticated: true}),
  onError: async error => error?.statusCode === 401 ? {logout: true, redirectTo: '/login'} : {}
};
export function Shell({children, ...panel}: Panel & {children: React.ReactNode}) {
  const {t, locale} = useT(), pathname = usePathname(), router = useRouter();
  const i18nProvider = useMemo<RefineI18nProvider>(() => ({
    translate: (key, _options, fallback) => {const text = t(key); return text === key && fallback ? fallback : text;},
    changeLocale: async next => {document.cookie = 'admin_locale=' + next + '; path=/; max-age=31536000; samesite=lax'; router.refresh();},
    getLocale: () => locale
  }), [t, locale, router]);
  const resources = useMemo(() => panel.meta.map(item => ({name: item.name, list: '/r/' + item.name, edit: '/r/' + item.name + '/:id',
    ...(item.canCreate ? {create: '/r/' + item.name + '/new'} : {})})), [panel.meta]);
  const link = (href: string, label: string) => {
    const current = href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');
    return <li key={href}><Link href={href} aria-current={current ? 'page' : undefined}>{label}</Link></li>;
  };
  return <PanelContext.Provider value={panel}><Suspense>
    <Refine dataProvider={dataProvider} routerProvider={routerProvider} authProvider={authProvider} i18nProvider={i18nProvider}
      accessControlProvider={{can:async({resource,action})=>{const item=panel.meta.find(m=>m.name===resource);return {can:!!item&&(action==='create'?item.canCreate:action==='edit'?item.canUpdate:action==='delete'?item.canDelete:true)};}}}
      resources={resources} options={{disableTelemetry: true, syncWithLocation: false, warnWhenUnsavedChanges: false}}>
      <a className="skip" href="#main">{t('skipToContent')}</a>
      <div className="layout">
        <header className="sidebar">
          <p className="brand">{t('appName')}</p>
          <nav aria-label={t('navigation')}>
            <ul>{link('/', t('nav.dashboard'))}{['OWNER','ADMIN'].includes(panel.user.role)&&link('/schools',t('school.title'))}{link('/moderation', t('nav.queue'))}{link('/claims', t('nav.claims'))}</ul>
            {groups.map(([group, names]) => <div key={group}>
              <p className="group" id={'group-' + group}>{t('group.' + group)}</p>
              <ul aria-labelledby={'group-' + group}>{names.map(name => link('/r/' + name, t('resource.' + name)))}</ul>
            </div>)}
          </nav>
          <div className="account">
            <p><strong>{panel.user.name}</strong><br/><span className="muted">{panel.user.email} · {t('role.' + panel.user.role)}</span></p>
            <LocaleSwitch/>
            <button type="button" className="button ghost" onClick={() => void signOut()}>{t('signOut')}</button>
          </div>
        </header>
        <main id="main" tabIndex={-1}>{children}</main>
      </div>
    </Refine>
  </Suspense></PanelContext.Provider>;
}
