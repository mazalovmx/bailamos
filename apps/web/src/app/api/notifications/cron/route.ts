import {apiError} from '../../../../lib/api';
import {cronAccess} from '../../../../lib/notifications/cron';
import {sendEventReminders} from '../../../../lib/notifications/reminders';
export const dynamic = 'force-dynamic';
// Alternative trigger for hosts without a background worker: POST with "Authorization: Bearer <CRON_SECRET>" every 5 minutes.
export async function POST(request: Request) {
  try {
    const access = cronAccess(request.headers.get('authorization'));
    if (access === 'OFF') return Response.json({error: 'NOT_FOUND'}, {status: 404});
    if (access === 'DENIED') return Response.json({error: 'UNAUTHORIZED'}, {status: 401, headers: {'WWW-Authenticate': 'Bearer'}});
    return Response.json(await sendEventReminders(), {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {return apiError(error);}
}
