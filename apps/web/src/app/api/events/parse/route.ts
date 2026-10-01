import {db} from '@dance/db';
import {z} from 'zod';
import {actor, apiError, ApiError, jsonBody} from '../../../../lib/api';
import {rateLimit} from '../../../../lib/rate-limit';
import {allStyles} from '../../../../lib/catalogue/data';
import {geocode} from '../../../../lib/geo/geocode';
import {parseAnnouncement, PARSES_PER_HOUR} from '../../../../lib/events/parse';
import {MAX_INPUT} from '../../../../lib/events/parse/contract';
import {parserEnabled} from '../../../../lib/events/parse/llm';
export const dynamic = 'force-dynamic';
const input = z.object({text: z.string().min(10).max(MAX_INPUT * 4), cityId: z.string().min(1).max(64)});
// POST /api/events/parse {text, cityId} — suggested values for the event form from a pasted announcement.
// {parsed: false} means "fill the form by hand": the parser is off, timed out or returned nothing usable.
export async function POST(request: Request) {
  try {
    const user = await actor(request);
    if (!user.profile) throw new ApiError('PROFILE_REQUIRED', 400);
    if (!parserEnabled()) throw new ApiError('NOT_FOUND', 404);
    const {text, cityId} = input.parse(await jsonBody(request));
    const limit = await rateLimit('event-parse:' + user.id, {limit: PARSES_PER_HOUR, windowSec: 3600});
    if (!limit.ok) return Response.json({error: 'PARSE_LIMIT'}, {status: 429, headers: {'Retry-After': String(limit.retryAfter)}});
    const city = await db.city.findUnique({where: {id: cityId}, select: {id: true, name: true, timezone: true, lat: true, lng: true, countryCode: true}});
    if (!city) throw new ApiError('INVALID_INPUT', 400);
    const [styles, venues] = await Promise.all([allStyles(),
      db.venue.findMany({where: {cityId, hiddenAt: null}, select: {id: true, name: true, address: true}, take: 500})]);
    const result = await parseAnnouncement(text, {city, styles, venues, geocode});
    const headers = {'Cache-Control': 'no-store'};
    if (!result) return Response.json({parsed: false}, {headers});
    const {cached, ...suggestion} = result;
    void cached;
    return Response.json({parsed: true, cityId, ...suggestion}, {headers});
  } catch (error) {return apiError(error);}
}
