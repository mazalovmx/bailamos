import {db} from '@dance/db';
import {DateTime} from 'luxon';
import {getTranslations} from 'next-intl/server';
import {notFound,redirect} from 'next/navigation';
import {currentUser} from '../../../../../lib/session';
import {eventAbility} from '../../../../../lib/permissions';
import {catalogue} from '../../../../../lib/catalogue';
import {EventForm} from '../../../../../components/forms';
export default async function Edit({params}:{params:Promise<{locale:string;slug:string}>}) {
  const {locale,slug}=await params,user=await currentUser();
  if(!user) redirect('/'+locale+'/login');
  const event=await db.event.findUnique({where:{slug},include:{members:true,styles:true,tags:true}});
  if(!event||!eventAbility(user.profile?.id,event.members).can('manage','Event')) notFound();
  const {cities,styles,tags}=await catalogue(),t=await getTranslations('App');
  const local=(d:Date)=>DateTime.fromJSDate(d,{zone:event.timezone}).toFormat("yyyy-MM-dd'T'HH:mm");
  return <main className="form-page"><h1>{t('editEvent')}</h1>{event.rrule&&<p className="notice">{t('editSeries')}</p>}<EventForm id={event.id} cities={cities} styles={styles} tags={tags} selectedTags={event.tags.map(t=>t.tagId)}
    initial={{title:event.title,description:event.description||'',cityId:event.cityId,styleId:event.styles[0]?.styleId||'',status:event.status,startsLocal:local(event.startsAt),endsLocal:event.endsAt?local(event.endsAt):'',
    kind:event.kind,format:event.format,level:event.level,intensity:event.intensity,tempo:event.tempo,prerequisites:event.prerequisites||'',partnerRequired:String(event.partnerRequired),
    recurrenceWeeks:event.rrule?.match(/COUNT=(\d+)/)?.[1]||'1'}}/></main>;
}
