import {actor,apiError,jsonBody} from '../../../lib/api';
import {createSchool} from '../../../lib/schools/manage';
export async function POST(request:Request){try{const user=await actor(request);const school=await createSchool(user.id,await jsonBody(request));return Response.json({id:school.id,handle:school.handle},{status:201});}catch(error){return apiError(error);}}
