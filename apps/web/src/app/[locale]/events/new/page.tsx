import {getTranslations} from 'next-intl/server';
import {redirect} from 'next/navigation';
import Link from 'next/link';
import {currentUser} from '../../../../lib/session';
import {catalogue} from '../../../../lib/catalogue';
import {EventForm} from '../../../../components/forms';
export default async function NewEvent({params}:{params:Promise<{locale:string}>}) {
  const {locale}=await params,user=await currentUser();
  if(!user) redirect('/'+locale+'/login');
  const t=await getTranslations('App');
  if(!user.profile) return <main className="form-page"><h1>{t('newEvent')}</h1><p>{t('profileRequired')}</p><Link className="button" href={'/'+locale+'/profile'}>{t('editProfile')}</Link></main>;
  const {cities,styles,tags}=await catalogue();
  return <main className="form-page"><h1>{t('createTitle')}</h1><p className="intro">{t('createText')}</p><EventForm cities={cities} styles={styles} tags={tags} initial={{cityId:user.profile.cityId||'',styleId:'lindy-hop'}}/></main>;
}
