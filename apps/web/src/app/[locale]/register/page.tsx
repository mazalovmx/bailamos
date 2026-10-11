import {getTranslations as pageTitle} from 'next-intl/server';
import {AuthForm} from '../../../components/account/auth-form';
import {enabledSocialProviders} from '../../../lib/account/social-providers';
import {returnTarget} from '../../../lib/login-path';
export async function generateMetadata() {const t = await pageTitle('App'); return {title: t('signUp')};}
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{next?:string}>}) {
  const {locale}=await params,{next}=await searchParams;
  return <main><AuthForm mode="register" providers={enabledSocialProviders()} next={returnTarget(locale,next)}/></main>;
}
