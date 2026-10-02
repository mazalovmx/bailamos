import {db} from '@dance/db';
import {redirect} from 'next/navigation';
import {pageStaff} from '../../lib/guard';
import {schoolList,schoolResources} from '../../lib/schools';
import {SchoolsPanel} from '../../components/schools-panel';
import {webOrigin} from '../../lib/env';
import {SchoolGuide} from '../../components/school-guide';
export const dynamic='force-dynamic';
export default async function Schools({searchParams}:{searchParams:Promise<{school?:string}>}){
  const user=await pageStaff(true);
  if(user.role==='MODERATOR')redirect('/');
  const schools=await schoolList(user.id),requested=(await searchParams).school,schoolId=requested||schools[0]?.id;
  if(schoolId&&!schools.some(s=>s.id===schoolId))redirect('/schools');
  const global=user.role==='OWNER'||user.role==='ADMIN';
  const [data,cities,styles,admins]=await Promise.all([
    schoolId?schoolResources(user.id,schoolId):null,
    db.city.findMany({select:{id:true,name:true},orderBy:{name:'asc'}}),
    db.danceStyle.findMany({select:{id:true,name:true},orderBy:{name:'asc'}}),
    global&&schoolId?db.schoolAdmin.findMany({where:{schoolProfileId:schoolId},select:{user:{select:{email:true,name:true}}}}):[]]);
  return <><SchoolGuide userId={user.id} global={global}/><SchoolsPanel webUrl={webOrigin()} global={global} schools={schools} schoolId={schoolId} data={JSON.parse(JSON.stringify(data))} cities={cities} styles={styles} admins={admins.map(a=>a.user)}/></>;
}
