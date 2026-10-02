import {getTranslations} from 'next-intl/server';
import {redirect} from 'next/navigation';
import Link from 'next/link';
import {currentUser} from '../../../../lib/session';
import {catalogue} from '../../../../lib/catalogue';
import {managedSchools} from '../../../../lib/schools/access';
import {EventForm} from '../../../../components/forms';
import {SectionGuide} from '../../../../components/guide/section-guide';
import '../../../styles/events.css';
export async function generateMetadata(){const t=await getTranslations('App');return {title:t('newEvent'),robots:{index:false,follow:false}};}
export default async function NewEvent({params}:{params:Promise<{locale:string}>}) {
  const {locale}=await params,user=await currentUser();
  if(!user) redirect('/'+locale+'/login?next='+encodeURIComponent('/'+locale+'/events/new'));
  const t=await getTranslations('App'),x=await getTranslations('EventsX');
  if(!user.profile) return <main className="form-page"><h1>{t('newEvent')}</h1><p>{t('profileRequired')}</p><Link className="button" href={'/'+locale+'/profile'}>{t('editProfile')}</Link></main>;
  const [{cities,styles,tags},schools]=await Promise.all([catalogue(locale),managedSchools(user.schoolIds)]);
  return <main className="form-page event-editor"><SectionGuide id="event" userId={user.id} steps={['intro','details','place','schedule','publish']}/><div data-guide="event-intro"><h1>{t('createTitle')}</h1><p className="intro">{t('createText')}</p><p className="field-note">{x('createNext')}</p></div>
    <EventForm cities={cities} styles={styles} tags={tags} schools={schools} initial={{cityId:user.profile.cityId||'',styleId:'lindy-hop'}}/></main>;
}
