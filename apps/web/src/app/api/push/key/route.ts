import {vapid} from '../../../../lib/notifications/push';
export const dynamic = 'force-dynamic';
// The public VAPID key a browser needs to subscribe; null while push is not configured.
export async function GET() {
  return Response.json({key: vapid()?.publicKey ?? null}, {headers: {'Cache-Control': 'no-store'}});
}
