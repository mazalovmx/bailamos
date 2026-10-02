import {ApiError, apiError} from '../../../../../lib/api';
import {rateLimit} from '../../../../../lib/rate-limit';
import {storage} from '../../../../../lib/storage';
import {chatViewer} from '../../../../../lib/chat/http';
import {limits} from '../../../../../lib/chat/policy';
import {attachmentKeyFor} from '../../../../../lib/chat/service';
import {FORMATS, WIDTHS, contentTypes, variantKey, type Format, type Width} from '../../../../../lib/media/keys';
// The image of a message, for current members of its conversation only: ?w=320|800|1600&f=avif|webp (default 800, webp).
// The bytes are always streamed from here, never redirected to a public bucket URL, and may be cached by the reader's browser only.
// A hidden or deleted message, a foreign conversation and an unknown id all answer 404.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, {params}: {params: Promise<{messageId: string}>}) {
  try {
    const me = await chatViewer(request), query = new URL(request.url).searchParams;
    if (!(await rateLimit('chat:attachment:' + me.userId, limits.attachmentRead)).ok) throw new ApiError('RATE_LIMITED', 429);
    const width = Number(query.get('w') ?? 800) as Width, format = (query.get('f') ?? 'webp') as Format;
    if (!WIDTHS.includes(width) || !FORMATS.includes(format)) throw new ApiError('INVALID_INPUT', 400);
    const object = await storage().getObject(variantKey(await attachmentKeyFor(me, (await params).messageId), width, format));
    if (!object) throw new ApiError('NOT_FOUND', 404);
    return new Response(object.body, {headers: {
      // The type comes from the key the server generated, not from anything the uploader said.
      'Content-Type': contentTypes[format],
      ...(object.size !== undefined ? {'Content-Length': String(object.size)} : {}),
      'Cache-Control': 'private, max-age=3600',
      Vary: 'Cookie',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline'
    }});
  } catch (error) {return apiError(error);}
}
