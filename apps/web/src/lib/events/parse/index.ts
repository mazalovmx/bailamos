import {randomUUID} from 'node:crypto';
import {DateTime} from 'luxon';
import {withRedis} from '../../redis';
import {buildMessages, cacheHash, cleanInput, parsedAnnouncement, type ParsedAnnouncement} from './contract';
import {deepseek, parserModel, type Llm} from './llm';
import {toSuggestion, type City, type Geocode, type Style, type Suggestion, type Venue} from './normalize';
// Announcement parser: pasted text → suggested values for the event form. The organizer always reviews the result;
// nothing here creates or publishes an event.
export const LOW_CONFIDENCE = 0.6, PARSES_PER_HOUR = 20, TIMEOUT_MS = 10_000;
const DAY = 24 * 60 * 60;
// The source text and the model's answer live for 24 hours (cache and debugging), then disappear on their own.
// Without Redis a small in-process store with the same lifetime is used.
const memory = new Map<string, {value: string; expires: number}>();
async function put(key: string, value: string) {
  const stored = await withRedis(redis => redis.set(key, value, 'EX', DAY));
  if (stored === undefined) {
    if (memory.size > 500) for (const [name, entry] of memory) if (entry.expires < Date.now() || memory.size > 400) memory.delete(name);
    memory.set(key, {value, expires: Date.now() + DAY * 1000});
  }
}
async function take(key: string) {
  const stored = await withRedis(redis => redis.get(key));
  if (stored !== undefined) return stored;
  const entry = memory.get(key);
  return entry && entry.expires > Date.now() ? entry.value : null;
}
export const clearParseMemory = () => memory.clear();
function decode(answer: string): ParsedAnnouncement | null {
  try {
    const result = parsedAnnouncement.safeParse(JSON.parse(answer));
    return result.success ? result.data : null;
  } catch {return null;}
}
export type ParseResult = Suggestion & {parseId: string; lowConfidence: boolean; cached: boolean};
export type ParseContext = {city: City; styles: readonly Style[]; venues: readonly Venue[]; geocode: Geocode; llm?: Llm; now?: Date};
// Returns null when the text cannot be parsed in time: the caller then offers the empty manual form.
export async function parseAnnouncement(text: string, context: ParseContext): Promise<ParseResult | null> {
  const input = cleanInput(text), now = context.now ?? new Date(), local = DateTime.fromJSDate(now, {zone: context.city.timezone});
  if (input.length < 10) return null;
  // Extraction sees the city name and the style codes, so answers from a different city/catalogue must not collide.
  const scope = JSON.stringify({cityId: context.city.id, cityName: context.city.name, styleCodes: context.styles.map(style => style.slug).sort()});
  const hash = cacheHash(input, context.city.timezone, local.toISODate() || '', scope), cacheKey = 'evparse:answer:' + hash;
  let parsed = decode((await take(cacheKey)) || ''), cached = !!parsed;
  if (!parsed) {
    const messages = buildMessages(input, {today: local.toISODate() || '', weekday: local.setLocale('en').toFormat('cccc'), zone: context.city.timezone,
      cityName: context.city.name, styleCodes: context.styles.map(style => style.slug)});
    // One deadline covers the call and its single retry.
    const signal = AbortSignal.timeout(TIMEOUT_MS), llm = context.llm ?? deepseek;
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      try {parsed = decode(await llm(messages, signal));}
      catch (error) {
        console.error(JSON.stringify({level: 'warn', event: 'event_parse_failed', attempt, message: error instanceof Error ? error.message : 'unknown'}));
        if (signal.aborted) break;
      }
    }
    if (!parsed) return null;
    cached = false;
    await put(cacheKey, JSON.stringify(parsed));
    await put('evparse:text:' + hash, input);
  }
  const suggestion = await toSuggestion(parsed, input, {...context, now});
  const parseId = randomUUID();
  // What was suggested is kept so that the saved event can be compared with it (share of fields the human changed).
  await put('evparse:result:' + parseId, JSON.stringify({fields: suggestion.fields, model: parserModel(), confidence: suggestion.confidence}));
  console.log(JSON.stringify({level: 'info', event: 'event_parse', parseId, model: parserModel(), cached, fields: Object.keys(suggestion.fields).length,
    confidence: suggestion.confidence, warnings: suggestion.warnings}));
  return {...suggestion, parseId, cached, lowConfidence: suggestion.confidence < LOW_CONFIDENCE};
}
// Telemetry of quality: how many suggested fields the organizer kept as they were. Written when the event is saved.
export async function recordParseFeedback(parseId: unknown, submitted: Record<string, unknown>) {
  if (typeof parseId !== 'string' || !/^[0-9a-f-]{36}$/.test(parseId)) return null;
  const stored = await take('evparse:result:' + parseId);
  if (!stored) return null;
  try {
    const {fields, model, confidence} = JSON.parse(stored) as {fields: Record<string, string>; model: string; confidence: number};
    const pin = submitted.pin && typeof submitted.pin === 'object' ? submitted.pin as {lat?: unknown; lng?: unknown} : null;
    const value = (name: string) => name === 'lat' || name === 'lng' ? (pin ? String(pin[name]) : '') : String(submitted[name] ?? '').trim();
    const names = Object.keys(fields), edited = names.filter(name => value(name) !== fields[name].trim());
    const feedback = {parseId, model, confidence, suggested: names.length, edited: edited.length, editedFields: edited,
      keptShare: names.length ? Number(((names.length - edited.length) / names.length).toFixed(3)) : null};
    console.log(JSON.stringify({level: 'info', event: 'event_parse_feedback', ...feedback}));
    return feedback;
  } catch {return null;}
}
