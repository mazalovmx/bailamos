import {db} from '@dance/db';
import {getTranslations} from 'next-intl/server';
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import Link from 'next/link';
import {currentUser} from '../../../lib/session';
import {auth, googleEnabled} from '../../../lib/auth';
import {describeAgent} from '../../../lib/account/sessions';
import {DeleteAccount} from '../../../components/account/delete-account';
import {ChangeEmail, ChangePassword, GoogleLink, SignOutOthers} from '../../../components/account/security';
import {NotificationPreferencesSection} from '../../../components/notifications/preferences-section';
import {TelegramLink} from '../../../components/notifications/telegram-link';
import '../../styles/account.css';
export async function generateMetadata() {
  const t = await getTranslations('Account');
  return {title: t('settingsTitle'), robots: {index: false}};
}
export default async function Settings({params, searchParams}: {params: Promise<{locale: string}>; searchParams: Promise<{emailChanged?: string; error?: string}>}) {
  const {locale} = await params, query = await searchParams, user = await currentUser();
  if (!user) redirect('/' + locale + '/login');
  const t = await getTranslations('Account');
  const [accounts, consents, sessions, current] = await Promise.all([
    db.account.findMany({where: {userId: user.id}, select: {providerId: true, password: true}}),
    db.consentLog.findMany({where: {userId: user.id}, orderBy: {createdAt: 'asc'}, select: {id: true, kind: true, granted: true, version: true, createdAt: true}}),
    db.session.findMany({where: {userId: user.id, expiresAt: {gt: new Date()}}, orderBy: {createdAt: 'desc'}, take: 50,
      select: {id: true, createdAt: true, ipAddress: true, userAgent: true}}),
    auth.api.getSession({headers: await headers()})]);
  const hasPassword = accounts.some(a => a.providerId === 'credential' && !!a.password), hasGoogle = accounts.some(a => a.providerId === 'google');
  const date = new Intl.DateTimeFormat(locale, {dateStyle: 'medium'}), dateTime = new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeStyle: 'short'});
  const currentId = current?.session.id, changed = query.emailChanged !== undefined, failed = typeof query.error === 'string';
  return <main className="form-page"><h1>{t('settingsTitle')}</h1><p className="intro">{t('settingsText', {email: user.email})}</p>
    {changed && !failed && <p className="notice" role="status">{t('emailChanged', {email: user.email})}</p>}
    {failed && <p className="form-error" role="alert">{t(changed ? 'emailChangeFailed' : 'googleLinkFailed')}</p>}
    <section className="account-section" aria-labelledby="email-title"><h2 id="email-title">{t('emailTitle')}</h2>
      <p>{t('emailText', {email: user.email})}</p>
      <ChangeEmail hasPassword={hasPassword}/>
    </section>
    <section className="account-section" aria-labelledby="methods-title"><h2 id="methods-title">{t('methodsTitle')}</h2>
      <ul className="account-list">
        <li>{t('methodPasswordState')}: {t(hasPassword ? 'enabled' : 'notSet')}{!hasPassword && <> · <Link href={'/' + locale + '/forgot-password'}>{t('setPassword')}</Link></>}</li>
        <li>{t('methodMagicState')}: {t('enabled')}</li>
        {(googleEnabled() || hasGoogle) && <li>{t('methodGoogleState')}: {t(hasGoogle ? 'connected' : 'notConnected')}</li>}
      </ul>
      <div className="account-actions">
        {hasPassword && <ChangePassword/>}
        <GoogleLink connected={hasGoogle} available={googleEnabled()} canUnlink={hasPassword}/>
      </div>
    </section>
    <section className="account-section" aria-labelledby="sessions-title"><h2 id="sessions-title">{t('sessionsTitle')}</h2><p>{t('sessionsText')}</p>
      <ul className="account-list">{sessions.map(s => <li key={s.id}>
        {describeAgent(s.userAgent) || t('sessionUnknownDevice')}{s.ipAddress ? ' · ' + s.ipAddress : ''} · {t('sessionSince', {date: dateTime.format(s.createdAt)})}
        {s.id === currentId && <> · <strong>{t('sessionCurrent')}</strong></>}</li>)}</ul>
      <SignOutOthers others={sessions.filter(s => s.id !== currentId).length}/>
    </section>
    <NotificationPreferencesSection userId={user.id}/>
    <TelegramLink/>
    <section className="account-section" aria-labelledby="consents-title"><h2 id="consents-title">{t('consentsTitle')}</h2><p>{t('consentsText')}</p>
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
