import {readFile} from 'node:fs/promises';
import path from 'node:path';
// MapLibre 6 starts its worker from a real same-origin module URL, and that module imports a sibling chunk by relative path.
// A bundler cannot provide that, so the two files are served verbatim from the installed package.
const files = new Set(['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']);
const cache = new Map<string, Uint8Array<ArrayBuffer>>();
export async function GET(_request: Request, {params}: {params: Promise<{file: string}>}) {
  const {file} = await params;
  if (!files.has(file)) return Response.json({error: 'NOT_FOUND'}, {status: 404});
  try {
    // The web app always runs with apps/web as its working directory (see scripts/start-web.mjs).
    const body = cache.get(file) || new Uint8Array(await readFile(path.join(process.cwd(), 'node_modules', 'maplibre-gl', 'dist', file)));
    cache.set(file, body);
    return new Response(body, {headers: {'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff'}});
  } catch { return Response.json({error: 'NOT_FOUND'}, {status: 404}); }
}
