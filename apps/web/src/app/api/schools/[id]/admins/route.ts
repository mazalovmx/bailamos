import {actor,apiError,jsonBody} from '../../../../../lib/api';
import {grantSchoolAdmin} from '../../../../../lib/schools/manage';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{const user=await actor(request);return Response.json(await grantSchoolAdmin(user.id,(await params).id,await jsonBody(request)));}catch(error){return apiError(error);}}
