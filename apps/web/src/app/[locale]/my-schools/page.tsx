import {db} from '@dance/db';
import {redirect} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {currentUser} from '../../../lib/session';
import {loginPath} from '../../../lib/login-path';
import {catalogue} from '../../../lib/catalogue';
import {SchoolForm} from '../../../components/schools/manage';
export default async function MySchools({params}:{params:Promise<{locale:string}>}){
  const {locale}=await params,user=await currentUser(),x=await getTranslations('EventsX');
  if(!user)redirect(loginPath(locale,'/my-schools'));
  if(!user.profile)redirect('/'+locale+'/onboarding?next='+encodeURIComponent('/'+locale+'/my-schools'));
  const [schools,{cities}]=await Promise.all([db.profile.findMany({where:{id:{in:user.schoolIds},type:'SCHOOL'},include:{schoolAdmins:{include:{user:{select:{name:true,email:true}}}}}}),catalogue(locale)]);
  const global=user.role==='OWNER'||user.role==='ADMIN',adminBase=(process.env.ADMIN_URL||'http://localhost:3001').replace(/\/+$/,'');
  return <main className="form-page"><h1>{x('mySchools')}</h1><p>{x('separateSchool')}</p><p>{x('schoolCreatorAccess')}</p>{schools.map(s=>{
    const owner=global||s.userId===user.id||s.schoolAdmins.some(g=>g.userId===user.id&&g.canManageAdmins);
    return <section key={s.id}><h2><a href={'/'+locale+'/schools/'+s.handle}>{s.name}</a></h2><p>{x(global?'schoolGlobalAccess':owner?'schoolRoleManager':'schoolRoleAdmin')}</p><a className="button" href={adminBase+'/schools?school='+encodeURIComponent(s.id)}>{x('schoolPanel')}</a><a className="button" href={'/'+locale+'/events/new?school='+s.id}>{x('schoolEvent')}</a>
      {owner&&<details><summary>{x('schoolAdmins')}</summary><ul>{s.schoolAdmins.map(g=><li key={g.userId}>{g.user.name} — {g.user.email} · {x(g.canManageAdmins?'schoolRoleManager':'schoolRoleAdmin')}</li>)}</ul><SchoolForm schoolId={s.id} adminUrl={adminBase}/></details>}</section>;
  })}<h2>{x('createSchool')}</h2><SchoolForm cities={cities}/></main>;
}
