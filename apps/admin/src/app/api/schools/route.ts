import {route,jsonBody} from '../../../lib/guard';
import {schoolList,createSchool} from '../../../lib/schools';
export const GET=route('SCHOOL',async(_request,user)=>Response.json(await schoolList(user.id)));
export const POST=route('ADMIN',async(request,user)=>Response.json(await createSchool(user.id,await jsonBody(request)),{status:201}));
