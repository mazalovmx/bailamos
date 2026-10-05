import {getTranslations as pageTitle} from 'next-intl/server';
import {AuthForm} from '../../../components/account/auth-form';
export async function generateMetadata() {const t = await pageTitle('App'); return {title: t('resetTitle'), robots: {index: false}};}
export default async function Page({searchParams}: {searchParams: Promise<{token?: string; error?: string}>}) {
  const {token, error} = await searchParams;
  return <main><AuthForm mode="reset" token={token} initialError={error || !token ? 'INVALID_TOKEN' : undefined}/></main>;
}
