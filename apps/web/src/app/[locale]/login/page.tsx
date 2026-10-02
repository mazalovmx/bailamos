import {getTranslations as pageTitle} from 'next-intl/server';
import {redirect} from 'next/navigation';
import {AuthForm} from '../../../components/account/auth-form';
import {googleEnabled} from '../../../lib/auth';
import {currentUser} from '../../../lib/session';
export async function generateMetadata() {const t = await pageTitle('App'); return {title: t('signIn')};}
export default async function Page({params, searchParams}: {params: Promise<{locale: string}>; searchParams: Promise<{error?: string; next?: string}>}) {
  const {locale} = await params, {error, next} = await searchParams;
  // Only a path inside this locale is accepted as a return target, so the link cannot send people off-site.
  const target = typeof next === 'string' && next.startsWith('/' + locale + '/') && !next.includes('//') && !next.includes('\\') && next.length < 300 ? next : undefined;
  if (!error && await currentUser()) redirect(target || '/' + locale + '/account');
  // Magic-link and Google failures come back as ?error=<code>; only a short code is passed on, never free text.
  const code = typeof error === 'string' && /^[A-Za-z0-9_]{1,60}$/.test(error) ? error.toUpperCase() : undefined;
  return <main><AuthForm mode="login" google={googleEnabled()} initialError={code} next={target}/></main>;
}
