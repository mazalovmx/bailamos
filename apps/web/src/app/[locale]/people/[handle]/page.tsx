import {db} from '@dance/db';
import {getTranslations} from 'next-intl/server';
import {notFound} from 'next/navigation';
import Link from 'next/link';
import {currentUser} from '../../../../lib/session';
export default async function PublicProfile({params}:{params:Promise<{locale:string;handle:string}>}) {
  const {locale,handle}=await params;
  const profile=await db.profile.findUnique({where:{handle},select:{userId:true,name:true,handle:true,type:true,bio:true,city:{select:{name:true}},skills:{select:{role:true,level:true,style:{select:{name:true}}}}}});
  if(!profile) notFound();
  const t=await getTranslations('App'),user=await currentUser();
  return <main className="detail-page"><div className="profile-avatar" aria-hidden="true">{profile.name.slice(0,1).toUpperCase()}</div>
    <p className="eyebrow">{t(profile.type)} · @{profile.handle}</p><h1>{profile.name}</h1><p className="intro">{profile.city?.name}</p>
    <p className="prose">{profile.bio||t('noBio')}</p><h2>{t('skill')}</h2>
    <div className="tags">{profile.skills.map((s,i)=><span key={i}>{s.style.name} · {t(s.role)} · {t(s.level)}</span>)}</div>
    {user?.id===profile.userId&&<Link className="button" href={'/'+locale+'/profile'}>{t('editProfile')}</Link>}
  </main>;
}
