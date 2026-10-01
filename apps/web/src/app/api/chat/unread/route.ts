import {apiError} from '../../../../lib/api';
import {chatViewer, noStore} from '../../../../lib/chat/http';
import {unreadCounts} from '../../../../lib/chat/service';
export async function GET(request: Request) {
  try {return Response.json(await unreadCounts(await chatViewer(request)), {headers: noStore});} catch (error) {return apiError(error);}
}
