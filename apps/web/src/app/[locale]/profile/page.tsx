import {getTranslations} from 'next-intl/server';
import {redirect} from 'next/navigation';
import {currentUser} from '../../../lib/session';
import {catalogue} from '../../../lib/catalogue';
import {ProfileForm} from '../../../components/forms';
export default async function Profile({params}:{params:Promise<{locale:string}>}) {
  const {locale}=await params,user=await currentUser();
  if(!user) redirect('/'+locale+'/login');
  const t=await getTranslations('App'),{cities,styles}=await catalogue(),p=user.profile,s=p?.skills[0];
  return <main className="form-page"><h1>{t('profileTitle')}</h1><p className="intro">{t('profileText')}</p>
    <ProfileForm cities={cities} styles={styles} initial={{name:p?.name||user.name,handle:p?.handle||'',bio:p?.bio||'',cityId:p?.cityId||'',type:p?.type||'DANCER',styleId:s?.styleId||'',role:s?.role||'',level:s?.level||''}}/></main>;
}
