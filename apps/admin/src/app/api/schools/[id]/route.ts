import {route,jsonBody} from '../../../../lib/guard';
import {schoolResources,createSchoolResource,changeSchoolResource} from '../../../../lib/schools';
type Context={params:Promise<{id:string}>};
export const GET=route<Context>('SCHOOL',async(_request,user,{params})=>Response.json(await schoolResources(user.id,(await params).id)));
export const POST=route<Context>('SCHOOL',async(request,user,{params})=>Response.json(await createSchoolResource(user.id,(await params).id,await jsonBody(request)),{status:201}));
export const PATCH=route<Context>('SCHOOL',async(request,user,{params})=>Response.json(await changeSchoolResource(user.id,(await params).id,await jsonBody(request))));
