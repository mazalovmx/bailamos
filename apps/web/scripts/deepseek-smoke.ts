import {config} from 'dotenv';
import {DateTime} from 'luxon';
import {buildMessages, parsedAnnouncement} from '../src/lib/events/parse/contract';
import {deepseek, parserModel} from '../src/lib/events/parse/llm';

config({path: '../../.env', quiet: true});

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is missing from apps/web environment or repository .env');
  const zone = 'America/Mexico_City';
  const today = DateTime.now().setZone(zone);
  const announcement = 'Weekly Lindy Hop class on Wednesday 14 October 2026, 19:00–20:30, at Swing City, Mexico City. 250 MXN. All levels welcome.';
  const messages = buildMessages(announcement, {today: today.toISODate()!, weekday: today.setLocale('en').toFormat('cccc'),
    zone, cityName: 'Mexico City', styleCodes: ['lindy-hop', 'solo-jazz']});
  const started = Date.now();
  try {
    const text = await deepseek(messages, AbortSignal.timeout(15_000));
    const decoded = parsedAnnouncement.safeParse(JSON.parse(text));
    if (!decoded.success) throw new Error('DeepSeek response did not match the parser schema');
    const result = decoded.data;
    const checks = {title: !!result.title, date: result.startsAtLocal === '2026-10-14T19:00', recurrence: result.recurrence === 'weekly', style: result.styles.some(value => /lindy/i.test(value))};
    console.log(JSON.stringify({model: parserModel(), api: 'reachable', jsonSchemaValid: true, latencyMs: Date.now() - started,
      extracted: {title: result.title, startsAtLocal: result.startsAtLocal, endsAtLocal: result.endsAtLocal, recurrence: result.recurrence,
        styles: result.styles, price: result.price, confidence: result.confidence}, checks}));
    if (Object.values(checks).some(value => !value)) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause as Error & {code?: string} : null;
    // The provider response body and credentials are deliberately never printed.
    console.error(JSON.stringify({model: parserModel(), api: 'failed', error: message.slice(0, 120), cause: cause?.code || cause?.name, latencyMs: Date.now() - started}));
    process.exitCode = 1;
  }
}
void main();
