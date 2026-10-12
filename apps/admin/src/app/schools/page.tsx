import {db, schoolPermissions} from '@dance/db';
import {redirect} from 'next/navigation';
import {pageStaff} from '../../lib/guard';
import {schoolList,schoolResources} from '../../lib/schools';
import {SchoolsPanel} from '../../components/schools-panel';
import {webOrigin, adminOrigin} from '../../lib/env';
import {SchoolGuide} from '../../components/school-guide';
export const dynamic='force-dynamic';
export default async function Schools({searchParams}:{searchParams:Promise<{school?:string}>}){
  const user=await pageStaff(true);
  if(user.role==='MODERATOR'&&!user.hasSchoolAccess)redirect('/');
  const schools=await schoolList(user.id),requested=(await searchParams).school,schoolId=requested||schools[0]?.id;
  if(schoolId&&!schools.some(s=>s.id===schoolId))redirect('/schools');
  const global=user.role==='OWNER'||user.role==='ADMIN';
  const canManageAdmins=schoolId?(await schoolPermissions(user.id,schoolId)).canManageAdmins:false;
  const [data,cities,styles,admins]=await Promise.all([
    schoolId?schoolResources(user.id,schoolId):null,
    db.city.findMany({select:{id:true,name:true},orderBy:{name:'asc'}}),
    db.danceStyle.findMany({select:{id:true,name:true},orderBy:{name:'asc'}}),
    canManageAdmins&&schoolId?db.schoolAdmin.findMany({where:{schoolProfileId:schoolId},select:{canManageAdmins:true,user:{select:{id:true,email:true,name:true}}}}):[]]);
  return <><SchoolGuide userId={user.id} global={canManageAdmins}/><SchoolsPanel actorId={user.id} adminUrl={adminOrigin()} webUrl={webOrigin()} global={global} canManageAdmins={canManageAdmins} schools={schools} schoolId={schoolId} data={JSON.parse(JSON.stringify(data))} cities={cities} styles={styles} admins={admins.map(a=>({...a.user,canManageAdmins:a.canManageAdmins}))}/></>;
}
