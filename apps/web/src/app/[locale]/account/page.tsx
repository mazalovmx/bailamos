import {getTranslations} from 'next-intl/server';
import {redirect} from 'next/navigation';
import {currentUser} from '../../../lib/session';
export default async function Account({params}:{params:Promise<{locale:string}>}) {
  const {locale}=await params,user=await currentUser(),t=await getTranslations('App');
  if(!user)redirect('/'+locale+'/login');
  const actions=[['accountProfile',user.profile?'/profile':'/onboarding'],['accountEvents','/my-events'],['accountMessages','/messages'],['accountPartners','/partners'],['accountPosts','/posts'],['accountSettings','/settings']];
  return <main className="form-page"><p className="eyebrow">{t('accountHome')}</p><h1>{t('accountWelcome',{name:user.name})}</h1><p className="intro">{t('accountIntro')}</p><div className="home-capabilities">{actions.map(([key,path])=><a key={key} href={'/'+locale+path}><h2>{t(key)} ↗</h2></a>)}</div></main>;
}
