// Example: registering sources for the agenda importer (E14). Copy, edit the list, then run
//   pnpm --filter @dance/db exec dotenv -e ../../.env -- tsx prisma/import-sources.example.ts
// The same rows can be managed in the admin panel (Import sources). Re-running is safe: sources are matched by URL.
//
// kind        what the URL must return
// ICAL        an .ics calendar (Google Calendar "public address in iCal format", Meetup group calendar, ...)
// SCHEMA_ORG  a web page with Schema.org Event markup (JSON-LD or microdata)
// RSS         an RSS/Atom feed. With `news: true` its entries become news in the feed; without it only entries that
//             carry an event date (ev:startdate / xcal:dtstart) become events.
//
// `citySlug` is strongly recommended: it gives the timezone for times written without an offset, limits the
// geocoder to that country and is the fallback place when an item has no address. Without it an item needs
// coordinates (or a geocodable address) near a known city, otherwise it is rejected with note NO_CITY.
// Only add sources whose owners allow re-publication; the importer identifies itself with IMPORT_USER_AGENT.
import {db, ImportKind} from '../src/index';
const sources: {kind: ImportKind; url: string; name: string; citySlug?: string; news?: boolean}[] = [
  {kind: 'ICAL', url: 'https://example.org/swing-madrid.ics', name: 'Swing Madrid calendar', citySlug: 'madrid'},
  {kind: 'SCHEMA_ORG', url: 'https://example.org/agenda', name: 'Example venue agenda', citySlug: 'madrid'},
  {kind: 'RSS', url: 'https://example.org/blog/feed.xml', name: 'Example swing blog', news: true}
];
async function main() {
  for (const source of sources) {
    const city = source.citySlug ? await db.city.findUnique({where: {slug: source.citySlug}, select: {id: true}}) : null;
    if (source.citySlug && !city) {console.warn('Skipped (unknown city "' + source.citySlug + '"): ' + source.url); continue;}
    const data = {kind: source.kind, name: source.name, cityId: city?.id ?? null, news: source.news ?? false};
    await db.importSource.upsert({where: {url: source.url}, create: {url: source.url, ...data}, update: data});
    console.log('Saved: ' + source.name);
  }
  return 0;
}
main().catch(error => {console.error(error instanceof Error ? error.message : error); return 1;})
  .then(async code => {await db.$disconnect(); process.exitCode = code;});
