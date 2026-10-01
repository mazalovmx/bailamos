import {z} from 'zod';
import {runDueSources} from '../../../../lib/import/jobs';
import {processApproved, runSource} from '../../../../lib/import/run';
import {bearer, secretMatches} from '../../../../lib/import/secret';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const input = z.object({sourceId: z.string().min(1).max(64).optional(), force: z.boolean().default(false), approved: z.boolean().default(false)}).strict();
// Manual trigger: POST with "Authorization: Bearer <CRON_SECRET>".
// {"sourceId": "..."} runs one source now ("force": true ignores ETag/Last-Modified and the enabled flag),
// {"approved": true} only turns items approved in the admin panel into events, {} runs every source that is due.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({error: 'NOT_FOUND'}, {status: 404});
  if (!secretMatches(bearer(request.headers.get('authorization')), secret))
    return Response.json({error: 'UNAUTHORIZED'}, {status: 401, headers: {'WWW-Authenticate': 'Bearer'}});
  try {
    const text = (await request.text()).slice(0, 2000);
    let body: unknown = {};
    try {body = text.trim() ? JSON.parse(text) : {};} catch {return Response.json({error: 'INVALID_INPUT'}, {status: 400});}
    const parsed = input.safeParse(body);
    if (!parsed.success) return Response.json({error: 'INVALID_INPUT'}, {status: 400});
    const {sourceId, force, approved} = parsed.data, headers = {'Cache-Control': 'no-store'};
    if (approved) return Response.json({approved: await processApproved()}, {headers});
    if (!sourceId) return Response.json(await runDueSources(), {headers});
    const result = await runSource(sourceId, {force});
    return Response.json(result, {status: result.skipped === 'NOT_FOUND' ? 404 : 200, headers});
  } catch (error) {
    console.error(JSON.stringify({level: 'error', event: 'import_run_error', message: error instanceof Error ? error.message : 'unknown'}));
    return Response.json({error: 'SERVER_ERROR'}, {status: 500});
  }
}
