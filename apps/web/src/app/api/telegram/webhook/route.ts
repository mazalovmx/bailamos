import {secretMatches} from '../../../../lib/import/secret';
import {botConfig} from '../../../../lib/telegram/api';
import {handleUpdate} from '../../../../lib/telegram/bot';
export const dynamic = 'force-dynamic';
const MAX_BODY = 64_000;
// Telegram calls this for every update. The secret is the one given to setWebhook (secret_token) and comes back in the
// X-Telegram-Bot-Api-Secret-Token header. Without a bot token the endpoint does not exist; without a secret nothing is accepted.
export async function POST(request: Request) {
  const config = botConfig();
  if (!config) return Response.json({error: 'NOT_FOUND'}, {status: 404});
  if (!secretMatches(request.headers.get('x-telegram-bot-api-secret-token'), config.secret)) return Response.json({error: 'UNAUTHORIZED'}, {status: 401});
  const text = await request.text();
  if (text.length > MAX_BODY) return Response.json({ok: true});
  let update: unknown;
  try {update = JSON.parse(text);} catch {return Response.json({ok: true});}
  // Always 200 from here on: an error answer would make Telegram send the same update again and again.
  await handleUpdate(update);
  return Response.json({ok: true});
}
