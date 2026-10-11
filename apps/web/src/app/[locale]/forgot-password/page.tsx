import {getTranslations as pageTitle} from 'next-intl/server';
import {AuthForm} from '../../../components/account/auth-form';
import {enabledSocialProviders} from '../../../lib/account/social-providers';
import {returnTarget} from '../../../lib/login-path';
export async function generateMetadata() {const t = await pageTitle('App'); return {title: t('forgotTitle'), robots: {index: false}};}
export default async function Page({params, searchParams}: {params: Promise<{locale: string}>; searchParams: Promise<{error?: string; next?: string}>}) {
  const {locale} = await params, {error, next} = await searchParams;
  const code = typeof error === 'string' && /^[A-Za-z0-9_]{1,60}$/.test(error) ? error.toUpperCase() : undefined;
  return <main><AuthForm mode="forgot" providers={enabledSocialProviders()} initialError={code} next={returnTarget(locale, next)}/></main>;
}
