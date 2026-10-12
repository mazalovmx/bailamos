import {route,jsonBody} from '../../../../../lib/guard';
import {grantSchool} from '../../../../../lib/schools';
import {adminOrigin} from '../../../../../lib/env';
export const POST=route<{params:Promise<{id:string}>}>('SCHOOL',async(request,user,{params})=>Response.json({...await grantSchool(user.id,(await params).id,await jsonBody(request)),loginUrl:adminOrigin()+'/login'}));
