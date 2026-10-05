import {z} from 'zod';
import {apiError,jsonBody} from '../../../../../lib/api';
import {managedEvent} from '../../../../../lib/events/access';
import {extendSeries} from '../../../../../lib/events/extend';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{
  const {id}=await params;await managedEvent(request,id);
  const {count,version}=z.object({count:z.coerce.number().int().min(1).max(52),version:z.coerce.number().int().positive()}).parse(await jsonBody(request));
  return Response.json(await extendSeries(id,count,version));
}catch(error){return apiError(error);}}
