import {db} from '@dance/db';
import {redirect} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {currentUser} from '../../../lib/session';
import {loginPath} from '../../../lib/login-path';
import {publicEvent} from '../../../lib/events/access';
import {Bookmark} from '../../../components/events/bookmark';
export default async function SavedEvents({params}:{params:Promise<{locale:string}>}){
  const {locale}=await params,user=await currentUser(),x=await getTranslations('EventsX');if(!user)redirect(loginPath(locale,'/saved-events'));
  const rows=await db.eventBookmark.findMany({where:{userId:user.id,event:publicEvent},orderBy:{createdAt:'desc'},include:{event:{select:{id:true,title:true,slug:true,status:true}}}});
  return <main className="form-page"><h1>{x('savedEvents')}</h1><p>{x('bookmarkPrivate')}</p>{!rows.length&&<p>{x('noBookmarks')}</p>}{rows.map(({event})=><section key={event.id}><h2><a href={'/'+locale+'/events/'+event.slug}>{event.title}</a></h2><Bookmark eventId={event.id} initial/></section>)}</main>;
}
