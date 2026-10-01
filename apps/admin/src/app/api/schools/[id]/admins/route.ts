import {route,jsonBody} from '../../../../../lib/guard';
import {grantSchool} from '../../../../../lib/schools';
export const POST=route<{params:Promise<{id:string}>}>('ADMIN',async(request,user,{params})=>Response.json(await grantSchool(user.id,(await params).id,await jsonBody(request))));
