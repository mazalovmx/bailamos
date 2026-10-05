import {getTranslations as pageTitle} from 'next-intl/server';
import {AuthForm} from '../../../components/account/auth-form';
import {googleEnabled} from '../../../lib/auth';
import {returnTarget} from '../../../lib/login-path';
export async function generateMetadata() {const t = await pageTitle('App'); return {title: t('signUp')};}
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{next?:string}>}) {
  const {locale}=await params,{next}=await searchParams;
  return <main><AuthForm mode="register" google={googleEnabled()} next={returnTarget(locale,next)}/></main>;
}
