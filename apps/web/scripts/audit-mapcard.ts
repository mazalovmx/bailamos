// Browser check of the map card of a locally running build. Run from apps/web:  pnpm exec tsx scripts/audit-mapcard.ts [outDir]
// An organizer uploads the map photo in the event form; the photo and the note must then appear in the form preview,
// on the event page and in the popup of the public map. Uses a throwaway account that is deleted afterwards.
import {join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import sharp from 'sharp';
import {db} from '@dance/db';
import {openBrowser, sleep, type Page} from './audit-driver';
import {call, cleanup, makeAccount, tag, web} from './audit-auth';
const out = process.argv[2] || join(process.cwd(), '..', '..', 'test-results', 'audit-mapcard');
const findings: string[] = [];
const note = (text: string) => {findings.push(text); console.log('  !! ' + text);};
const ok = (text: string) => console.log('  ok  ' + text);
const local = (days: number, hour: number) => {const d = new Date(Date.now() + days * 86400000); d.setUTCHours(hour, 0, 0, 0); return d.toISOString().slice(0, 16);};
// Waits until the image is in the page and decoded; returns its natural width (0 = missing or broken).
async function imageWidth(page: Page, selector: string, seconds = 15) {
  for (let i = 0; i < seconds * 2; i++) {
    const width = await page.evaluate<number>(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e&&e.complete?e.naturalWidth:0})()`);
    if (width) return width;
    await sleep(500);
  }
  return 0;
}
// The list loads after the map reports its viewport; waits for the event's "Show on map" button instead of a fixed pause.
async function showOnMap(page: Page, title: string) {
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate<boolean>(`[...document.querySelectorAll('button.geo-link-button')].some(e=>e.textContent.includes(${JSON.stringify(title)}))`)) return page.click('button.geo-link-button', title);
    await sleep(500);
  }
  throw new Error('the event is not in the map list: ' + await page.text('.geo-status'));
}
// True when the popup lies entirely inside the map, so nothing of it is cut off.
const popupInside = (page: Page) => page.evaluate<boolean>(`(()=>{const p=document.querySelector('.maplibregl-popup'),m=document.querySelector('.geo-map'),c=document.querySelector('.geo-popup');if(!p||!m||!c||c.scrollHeight>c.clientHeight+1)return false;const a=p.getBoundingClientRect(),b=m.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1})()`);
async function main() {
  if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(process.env.DATABASE_URL || '').hostname)) throw new Error('Local database only');
  await mkdir(out, {recursive: true});
  const photo = join(out, 'entrance.jpg'), title = 'Map card check ' + tag, text = 'Blue door next to the bakery. Ring the bell twice.';
  await sharp({create: {width: 1200, height: 800, channels: 3, background: {r: 40, g: 110, b: 200}}}).jpeg().toFile(photo);
  const page = await openBrowser(web, out, 9446);
  try {
    const leo = await makeAccount('Leo Audit', 'DANCER');
    await page.setCookies(leo.cookie);
    await page.goto('/en/events/new');
    await page.click('.driver-popover-close-btn').catch(() => undefined);
    await page.fill('input[name=title]', title);
    await page.fill('textarea[name=description]', 'Open-air social dancing. No partner needed.');
    await page.fill('input[name=startsLocal]', local(3, 18)); await page.fill('input[name=endsLocal]', local(3, 21));
    await page.fill('select[name=cityId]', '');
    await page.clickAt('.event-place .geo-map');
    await sleep(3500);
    if (!await page.inputValue('input[name=pin]')) note('the marker was not set');
    // 1. upload in the form
    await page.setFile('.map-card-fields input[type=file]', photo);
    await page.click('.map-card-fields .media-upload button.button');
    const preview = await imageWidth(page, '.map-card-preview img', 30), key = await page.inputValue('input[name=mapImageKey]');
    await page.evaluate(`document.querySelector('.map-card-fields').scrollIntoView({block:'center',behavior:'instant'})`);
    await page.shot('form-preview');
    console.log('  form: key=' + key + ' preview width=' + preview + ' status=' + await page.text('.map-card-fields'));
    if (!key) note('form: the upload did not set the photo key');
    if (!preview) note('form: the preview of the uploaded photo is broken'); else ok('form shows the uploaded photo');
    await page.fill('textarea[name=mapNote]', text);
    await page.fill('select[name=status]', 'PUBLISHED');
    await page.click('form.editor-form button.button', 'Save');
    await sleep(1500);
    const event = await db.event.findFirst({where: {title}, select: {id: true, slug: true, status: true, mapImageKey: true, mapNote: true, lat: true, lng: true}});
    console.log('  saved: ' + JSON.stringify(event) + ' at ' + await page.url());
    if (!event?.mapImageKey) {note('the event was not saved with its map photo'); return;}
    // 2. endpoint and the file itself
    const place = await (await call(web, '/api/events/' + event.id + '/place', 'GET')).json() as {note: string | null; image: string | null};
    const file = place.image ? await fetch(new URL(place.image, web)) : null;
    console.log('  place: ' + JSON.stringify(place) + ' file: ' + file?.status + ' ' + file?.headers.get('content-type'));
    if (!file?.ok || !/^image\//.test(file.headers.get('content-type') || '')) note('the map photo address does not serve an image'); else ok('the photo is served');
    // 3. reopened editor keeps the photo
    await page.goto('/en/events/' + event.slug + '/edit');
    if (!await imageWidth(page, '.map-card-preview img')) note('editor: the saved photo is not shown'); else ok('editor shows the saved photo');
    // 4. event page
    await page.goto('/en/events/' + event.slug);
    const onPage = await imageWidth(page, '.event-map-card img');
    await page.shot('event-page');
    if (!onPage) note('event page: the map photo is missing or broken'); else ok('event page shows the photo');
    if (!(await page.text('main')).includes('Ring the bell twice')) note('event page: the note is missing');
    // 5. popup on the public map, signed out
    await page.setCookies('');
    await page.goto('/en/map?city=madrid');
    await showOnMap(page, title);
    await sleep(2500);
    const inPopup = await imageWidth(page, '.geo-popup .geo-popup-photo'), popupText = await page.text('.geo-popup');
    const box = await page.evaluate<{w: number; h: number; pw: number} | null>(`(()=>{const i=document.querySelector('.geo-popup-photo'),p=document.querySelector('.maplibregl-popup-content');if(!i||!p)return null;const r=i.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),pw:Math.round(p.getBoundingClientRect().width)}})()`);
    await page.evaluate(`document.querySelector('.geo-map').scrollIntoView({block:'center',behavior:'instant'})`);
    await sleep(500);
    await page.shot('map-popup', false);
    console.log('  popup: photo width=' + inPopup + ' box=' + JSON.stringify(box) + ' text=' + JSON.stringify(popupText));
    if (!inPopup) note('map popup: the photo is missing or broken'); else ok('map popup shows the photo');
    if (!popupText.includes('Ring the bell twice')) note('map popup: the note is missing'); else ok('map popup shows the note');
    if (box && box.w > box.pw) note('map popup: the photo is wider than the popup');
    if (!await popupInside(page)) note('map popup: part of the popup is outside the map'); else ok('the popup fits inside the map');
    // 6. phone width
    await page.width(390);
    await page.goto('/en/map?city=madrid');
    await showOnMap(page, title);
    await sleep(2500);
    const phone = await imageWidth(page, '.geo-popup .geo-popup-photo');
    await page.evaluate(`document.querySelector('.geo-map').scrollIntoView({block:'center',behavior:'instant'})`);
    await sleep(500);
    await page.shot('map-popup-phone', false);
    if (!phone) note('map popup at 390 px: the photo is missing'); else ok('map popup at 390 px shows the photo');
    if (!await popupInside(page)) note('map popup at 390 px: part of the popup is outside the map'); else ok('the popup fits inside the map at 390 px');
    if (await page.evaluate<boolean>('document.documentElement.scrollWidth>innerWidth+1')) note('map at 390 px: horizontal overflow');
    for (const error of page.errors) note('JS: ' + error);
    for (const failure of page.failed) note('HTTP: ' + failure);
  } finally {
    await page.close();
    await cleanup();
  }
  console.log('\n' + (findings.length ? findings.length + ' findings:\n- ' + findings.join('\n- ') : 'No findings.'));
  process.exit(findings.length ? 1 : 0);
}
main().catch(error => {console.error(error); process.exit(1);});
