'use client';
import {usePathname, useRouter} from 'next/navigation';
import {useTranslations, useLocale} from 'next-intl';
import {useRef, useState} from 'react';
import {UnreadBadge} from './chat/unread-badge';
import {SearchBox} from './search/search-box';
import {NotificationBell} from './notifications/bell';
import {signOutCleanup} from './pwa/worker';
export function Header({signedIn}:{signedIn:boolean}) {
  const t=useTranslations('App'), locale=useLocale(), path=usePathname(), router=useRouter();
  const calendar=useTranslations('Calendar'), geo=useTranslations('Geo'), catalogue=useTranslations('Catalogue'), account=useTranslations('Account');
  const feed=useTranslations('Feed'), matching=useTranslations('Matching'), courses=useTranslations('Courses'), blog=useTranslations('Blog');
  const [busy,setBusy]=useState(false);
  const menu=useRef<HTMLDetailsElement>(null);
  const links=<>      <a href={'/'+locale+'/events'}>{t('events')}</a>
      <a href={'/'+locale+'/calendar'}>{calendar('title')}</a>
      <a href={'/'+locale+'/map'}>{geo('mapEyebrow')}</a>
      <a href={'/'+locale+'/cities'}>{catalogue('citiesTitle')}</a>
      <a href={'/'+locale+'/styles'}>{catalogue('stylesTitle')}</a>
      <a href={'/'+locale+'/classes'}>{courses('classesTitle')}</a>
      <a href={'/'+locale+'/schools'}>{courses('schoolsTitle')}</a>
      <a href={'/'+locale+'/feed'}>{feed('title')}</a>
      <a href={'/'+locale+'/share'}>{t('announcement')}</a>
      {signedIn ? <><a href={'/'+locale+'/account'}>{t('accountHome')}</a><a href={'/'+locale+'/my-events'}>{t('myEvents')}</a><a href={'/'+locale+'/profile'}>{t('profile')}</a>
        <a href={'/'+locale+'/partners'}>{matching('title')}</a><a href={'/'+locale+'/posts'}>{blog('myPostsTitle')}</a>
        <a href={'/'+locale+'/settings'}>{account('settingsTitle')}</a>
        <UnreadBadge signedIn/><NotificationBell/>
        <button disabled={busy} onClick={async()=>{setBusy(true);try{await signOutCleanup().catch(()=>undefined);const r=await fetch('/api/auth/sign-out',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(r.ok){router.push('/'+locale);router.refresh();}}finally{setBusy(false);}}}>{t('signOut')}</button>
      </> : <a href={'/'+locale+'/login'}>{t('signIn')}</a>}
</>;
  return <header className="app-header" onKeyDown={e=>{if(e.key==='Escape'&&menu.current?.open){menu.current.open=false;menu.current.querySelector('summary')?.focus();}}}>
    <a className="brand" href={'/'+locale}>dance<span>community</span></a>
    <SearchBox/>
    <nav className="main-nav desktop-nav" aria-label={t('navigation')}>{links}</nav>
    <details className="header-menu" ref={menu}>
      <summary className="menu-toggle">{t('openMenu')} <span aria-hidden="true">☰</span></summary>
      <nav className="main-nav mobile-nav" aria-label={t('navigation')}>{links}</nav>
    </details>
    <nav className="language-nav" aria-label={t('language')}>{['en','es','ru'].map(code=>
      <a key={code} href={path.replace(/^\/(en|es|ru)(?=\/|$)/,'/'+code)} onClick={e=>{e.preventDefault();window.location.href=path.replace(/^\/(en|es|ru)(?=\/|$)/,'/'+code)+window.location.search;}} lang={code} hrefLang={code} aria-current={code===locale?'page':undefined}>{code.toUpperCase()}</a>)}</nav>
  </header>;
}
