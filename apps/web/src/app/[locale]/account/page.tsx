import {getTranslations} from 'next-intl/server';
import {redirect} from 'next/navigation';
import {currentUser} from '../../../lib/session';
import {SectionGuide} from '../../../components/guide/section-guide';
export default async function Account({params}:{params:Promise<{locale:string}>}) {
  const {locale}=await params,user=await currentUser(),t=await getTranslations('App');
  if(!user)redirect('/'+locale+'/login');
  const actions=[['accountProfile',user.profile?'/profile':'/onboarding','profile'],['accountEvents','/my-events','events'],['accountMessages','/messages','community'],['accountPartners','/partners','community'],['accountPosts','/posts','share'],['accountSettings','/settings','profile']] as const;
  return <main className="form-page"><SectionGuide id="account" userId={user.id} steps={['home','profile']}/><p className="eyebrow">{t('accountHome')}</p><h1 data-guide="account-home">{t('accountWelcome',{name:user.name})}</h1><p className="intro">{t('accountIntro')}</p><div className="home-capabilities">{actions.map(([key,path,guide])=><a key={key} data-guide={'account-'+guide} href={'/'+locale+path}><h2>{t(key)} →</h2></a>)}<a data-guide="account-schools" href={'/'+locale+'/schools'}><h2>{t('homeKindSchools')} →</h2></a><a data-guide="account-share" href={'/'+locale+'/share'}><h2>{t('studioTitle')} →</h2></a></div></main>;
}
