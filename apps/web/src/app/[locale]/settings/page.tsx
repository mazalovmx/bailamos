import {db} from '@dance/db';
import {getTranslations} from 'next-intl/server';
import {redirect} from 'next/navigation';
import Link from 'next/link';
import {currentUser} from '../../../lib/session';
import {googleEnabled} from '../../../lib/auth';
import {DeleteAccount} from '../../../components/account/delete-account';
import {NotificationPreferencesSection} from '../../../components/notifications/preferences-section';
import '../../styles/account.css';
export async function generateMetadata() {
  const t = await getTranslations('Account');
  return {title: t('settingsTitle'), robots: {index: false}};
}
export default async function Settings({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params, user = await currentUser();
  if (!user) redirect('/' + locale + '/login');
  const t = await getTranslations('Account');
  const [accounts, consents] = await Promise.all([
    db.account.findMany({where: {userId: user.id}, select: {providerId: true, password: true}}),
    db.consentLog.findMany({where: {userId: user.id}, orderBy: {createdAt: 'asc'}, select: {id: true, kind: true, granted: true, version: true, createdAt: true}})]);
  const hasPassword = accounts.some(a => a.providerId === 'credential' && !!a.password), hasGoogle = accounts.some(a => a.providerId === 'google');
  const date = new Intl.DateTimeFormat(locale, {dateStyle: 'medium'});
  return <main className="form-page"><h1>{t('settingsTitle')}</h1><p className="intro">{t('settingsText', {email: user.email})}</p>
    <section className="account-section" aria-labelledby="methods-title"><h2 id="methods-title">{t('methodsTitle')}</h2>
      <ul className="account-list">
        <li>{t('methodPasswordState')}: {t(hasPassword ? 'enabled' : 'notSet')}{!hasPassword && <> · <Link href={'/' + locale + '/forgot-password'}>{t('setPassword')}</Link></>}</li>
        <li>{t('methodMagicState')}: {t('enabled')}</li>
        {(googleEnabled() || hasGoogle) && <li>{t('methodGoogleState')}: {t(hasGoogle ? 'connected' : 'notConnected')}</li>}
      </ul>
      {hasPassword && <p><Link href={'/' + locale + '/forgot-password'}>{t('changePassword')}</Link></p>}
    </section>
    <NotificationPreferencesSection userId={user.id}/>
    <section className="account-section" aria-labelledby="consents-title"><h2 id="consents-title">{t('consentsTitle')}</h2>
      {consents.length ? <ul className="account-list">{consents.map(c => <li key={c.id}>
        {t.has('consent_' + c.kind) ? t('consent_' + c.kind) : c.kind} · {t(c.granted ? 'consentGranted' : 'consentWithdrawn')} · {date.format(c.createdAt)}{c.version ? ' · ' + t('policyVersion', {version: c.version}) : ''}</li>)}</ul> :
        <p>{t('noConsents')}</p>}
      <p><Link href={'/' + locale + '/privacy'}>{t('readPolicy')}</Link></p>
    </section>
    <section className="account-section" aria-labelledby="export-title"><h2 id="export-title">{t('exportTitle')}</h2><p>{t('exportText')}</p>
      <a className="button secondary" href="/api/account/export" download>{t('exportButton')}</a></section>
    <section className="account-section" aria-labelledby="delete-title"><h2 id="delete-title">{t('deleteTitle')}</h2><p>{t('deleteText')}</p>
      <DeleteAccount hasPassword={hasPassword}/></section>
  </main>;
}
