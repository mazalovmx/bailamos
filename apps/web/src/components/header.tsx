'use client';
import {usePathname, useRouter} from 'next/navigation';
import {useTranslations, useLocale} from 'next-intl';
import {useState} from 'react';
import Link from 'next/link';
export function Header({signedIn}:{signedIn:boolean}) {
  const t=useTranslations('App'), locale=useLocale(), path=usePathname(), router=useRouter();
  const [busy,setBusy]=useState(false);
  return <header className="app-header">
    <Link className="brand" href={'/'+locale}>dance<span>community</span></Link>
    <nav className="main-nav" aria-label={t('events')}>
      <Link href={'/'+locale+'/events'}>{t('events')}</Link>
      <Link href={'/'+locale+'/share'}>{t('announcement')}</Link>
      {signedIn ? <><Link href={'/'+locale+'/my-events'}>{t('myEvents')}</Link><Link href={'/'+locale+'/profile'}>{t('profile')}</Link>
        <button disabled={busy} onClick={async()=>{setBusy(true);try{const r=await fetch('/api/auth/sign-out',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(r.ok){router.push('/'+locale);router.refresh();}}finally{setBusy(false);}}}>{t('signOut')}</button>
      </> : <Link href={'/'+locale+'/login'}>{t('signIn')}</Link>}
    </nav>
    <nav className="language-nav" aria-label={t('language')}>{['en','es','ru'].map(code=>
      <a key={code} href={path.replace(/^\/(en|es|ru)(?=\/|$)/,'/'+code)} onClick={e=>{e.preventDefault();window.location.href=path.replace(/^\/(en|es|ru)(?=\/|$)/,'/'+code)+window.location.search;}} lang={code} hrefLang={code} aria-current={code===locale?'page':undefined}>{code.toUpperCase()}</a>)}</nav>
  </header>;
}
