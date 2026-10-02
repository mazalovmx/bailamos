// UX audit of two journeys against a locally running build, through a real browser:
//   B. a school owner who registers, turns the profile into a school, creates weekly classes and one workshop;
//   A. a dancer who looks for events, registers and answers one of them.
// Run from apps/web:  pnpm exec tsx scripts/audit-journeys.ts [outDir]
// Every step prints what the user sees (URL, heading, notices, fields, actions) and saves a screenshot.
// Accounts and events created here are deleted at the end. Local database only.
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {config} from 'dotenv';
import {db} from '@dance/db';
import {openBrowser, sleep, type Page} from './audit-driver';
config({path: '../../.env', quiet: true});
const origin = process.env.AUDIT_ORIGIN || 'http://localhost:3000';
const out = process.argv[2] || join(process.cwd(), '..', '..', 'test-results', 'audit');
const tag = randomUUID().slice(0, 6), users: string[] = [];
const findings: string[] = [];
const note = (text: string) => {findings.push(text); console.log('  !! ' + text);};
type Seen = {url: string; title: string; h1: string[]; h2: string[]; notices: string[]; fields: string[]; actions: string[]; overflowX: boolean};
async function look(page: Page, name: string, quiet = false) {
  const seen = await page.describe() as Seen;
  await page.shot(name);
  console.log('\n[' + name + '] ' + (quiet ? JSON.stringify({url: seen.url, title: seen.title, h1: seen.h1, h2: seen.h2, notices: seen.notices, actions: seen.actions}) : JSON.stringify(seen)));
  if (seen.overflowX) note(name + ': horizontal overflow');
  if (/find your rhythm/.test(seen.title) && !/^\/(en|es|ru)\/?$/.test(seen.url)) note(name + ': page has no title of its own (' + seen.url + ')');
  return seen;
}
async function register(page: Page, name: string, email: string, password: string) {
  await page.goto('/en/register');
  await page.fill('input[name=name]', name); await page.fill('input[name=email]', email); await page.fill('input[name=password]', password);
  await page.check('input[name=consent]');
  await page.click('form button.button');
  const user = await db.user.findUnique({where: {email}});
  if (!user) throw new Error('registration did not create the account');
  users.push(user.id);
  // The verification mail goes to Mailpit; the audit confirms the address directly.
  await db.user.update({where: {id: user.id}, data: {emailVerified: true}});
  await page.goto('/en/login');
  await page.fill('input[name=email]', email); await page.fill('input[name=password]', password);
  await page.click('form button.button');
  await sleep(800);
  return user.id;
}
async function onboard(page: Page, role: string, level: string) {
  await page.goto('/en/profile');
  if (!(await page.url()).includes('/onboarding')) return;
  await page.fill('select[name=cityId]', (await db.city.findFirstOrThrow({where: {slug: 'madrid'}})).id);
  await page.check('input[name=styleIds][value="lindy-hop"]').catch(() => page.check('input[name=styleIds]'));
  await page.fill('select[name=role]', role); await page.fill('select[name=level]', level);
  await page.click('form button.button');
}
const local = (days: number, hour: number) => {const d = new Date(Date.now() + days * 86400000); d.setUTCHours(hour, 0, 0, 0); return d.toISOString().slice(0, 16);};
async function createEvent(page: Page, input: {title: string; kind: string; weekly: boolean; days: number; schoolId?: string; label: string}) {
  await page.goto('/en/events/new');
  await page.fill('input[name=title]', input.title);
  await page.fill('textarea[name=description]', input.title + '. Friendly group, no partner needed, bring comfortable shoes.');
  if (input.schoolId) await page.fill('select[name=schoolProfileId]', input.schoolId);
  await page.fill('select[name=kind]', input.kind);
  await page.fill('input[name=priceText]', '12 € per class');
  await page.fill('input[name=startsLocal]', local(input.days, 19)); await page.fill('input[name=endsLocal]', local(input.days, 20));
  if (input.weekly) {
    await page.fill('select:has(option[value="WEEKLY"])', 'WEEKLY');
    await sleep(300);
    const controls = (await page.describe() as Seen).fields.filter(field => /recurrence|select-one|date/.test(field));
    console.log('  weekly controls: ' + JSON.stringify(controls));
    await page.fill('input[name=recurrenceWeeks]', '6').catch(() => note('weekly: no "number of dates" input after choosing weekly'));
  }
  await page.fill('select[name=status]', 'PUBLISHED');
  await look(page, input.label + '-form', true);
  await page.click('form.editor-form button.button', 'Save');
  await sleep(1200);
  const after = await look(page, input.label + '-saved', true);
  if (!after.url.includes('/edit')) note(input.label + ': saving did not lead to the event editor (' + after.url + '; notices: ' + after.notices.join(' | ') + ')');
  return after.url.split('/events/')[1]?.split('/')[0];
}
async function journeyB(page: Page) {
  console.log('\n===== B. School owner =====');
  await register(page, 'Swing Studio Audit', 'school-' + tag + '@example.test', 'Audit-' + randomUUID());
  await look(page, 'b-after-login', true);
  await onboard(page, 'BOTH', 'ADVANCED');
  await page.goto('/en/profile');
  await page.fill('select[name=type]', 'SCHOOL');
  await page.fill('textarea[name=bio]', 'Weekly Lindy Hop and solo jazz classes in the centre of Madrid.');
  await page.click('form button.button', 'Save profile');
  await look(page, 'b-profile-saved');
  const profile = await db.profile.findFirstOrThrow({where: {userId: users.at(-1)}});
  if (profile.type !== 'SCHOOL') note('profile type did not become SCHOOL after saving (is ' + profile.type + ')');
  await page.goto('/en/account');
  const home = await look(page, 'b-account-home', true);
  if (!home.h2.concat(home.actions).some(text => /class|school|timetable/i.test(text))) note('account home of a SCHOOL offers nothing about classes, the timetable or the school page');
  await page.goto('/en/schools/' + profile.handle);
  const empty = await look(page, 'b-school-empty', true);
  if (!empty.actions.some(text => /add|create|class|event/i.test(text))) note('empty school page gives its owner no way to add a class (actions: ' + empty.actions.join(', ') + ')');
  await page.goto('/en/schools');
  const directory = await page.text('main');
  if (!directory.includes('Swing Studio Audit')) note('new school is not listed in /schools');
  const classSlug = await createEvent(page, {title: 'Lindy Hop Beginners ' + tag, kind: 'CLASS', weekly: true, days: 3, schoolId: profile.id, label: 'b-class'});
  const classEvent = classSlug ? await db.event.findUnique({where: {slug: classSlug}, include: {occurrences: true, members: true}}) : null;
  console.log('  class in DB: ' + JSON.stringify(classEvent && {status: classEvent.status, rrule: classEvent.rrule, dates: classEvent.occurrences.length, school: classEvent.schoolProfileId === profile.id,
    members: classEvent.members.map(member => member.role)}));
  if (classEvent && classEvent.occurrences.length < 2) note('weekly class was saved with ' + classEvent.occurrences.length + ' date(s)');
  if (classEvent && classEvent.schoolProfileId !== profile.id) note('class was not attached to the school');
  if (classEvent && classEvent.members.length > 1) note('a school publishing as itself got ' + classEvent.members.length + ' memberships: ' + classEvent.members.map(member => member.role).join(','));
  const workshopSlug = await createEvent(page, {title: 'Charleston Workshop ' + tag, kind: 'WORKSHOP', weekly: false, days: 10, schoolId: profile.id, label: 'b-workshop'});
  if (classSlug) {await page.goto('/en/events/' + classSlug + '/edit'); await look(page, 'b-class-editor', true);}
  await page.goto('/en/schools/' + profile.handle);
  const school = await look(page, 'b-school-filled', true), schoolText = await page.text('main');
  // A class that starts next week is reached through the link the empty week offers.
  if (!schoolText.includes('Lindy Hop Beginners')) {
    await page.click('main a', 'First classes').catch(() => note('school page: the week is empty and nothing points to the first week with classes'));
    await look(page, 'b-school-first-week', true);
    if (!(await page.text('main')).includes('Lindy Hop Beginners')) note('weekly class does not show on the school page, even in its first week');
    await page.goto('/en/schools/' + profile.handle);
  }
  if (!schoolText.includes('Charleston Workshop')) note('workshop does not show on the school page');
  void school;
  // The city timetable is checked in the week of the first class.
  const firstDate = classEvent?.occurrences.map(o => o.startsAt).sort((x, y) => x.getTime() - y.getTime())[0];
  await page.goto('/en/classes?city=madrid' + (firstDate ? '&week=' + firstDate.toISOString().slice(0, 10) : ''));
  await look(page, 'b-classes-madrid', true);
  if (!(await page.text('main')).includes('Lindy Hop Beginners')) note('weekly class does not show in the city timetable for its own week');
  await page.goto('/en/my-events');
  await look(page, 'b-my-events', true);
  if (classSlug) {await page.goto('/en/events/' + classSlug); await look(page, 'b-class-public', true);}
  return {classSlug, workshopSlug, handle: profile.handle};
}
async function journeyA(page: Page, made: {classSlug?: string; workshopSlug?: string; handle: string}) {
  console.log('\n===== A. Dancer looking for events =====');
  // Sign out through the menu, as a user would.
  await page.click('.site-menu-account summary').catch(() => note('no account menu in the header'));
  await page.click('.site-menu-account button', 'Sign out').catch(() => note('no Sign out in the account menu'));
  await sleep(800);
  await page.goto('/en');
  await look(page, 'a-home', true);
  await page.goto('/en/events');
  const list = await look(page, 'a-events', true), listText = await page.text('main');
  if (!listText.includes('Lindy Hop Beginners')) note('published class is not in the events list');
  if (!listText.includes('Charleston Workshop')) note('published workshop is not in the events list');
  void list;
  await page.goto('/en/events?kind=WORKSHOP');
  if (!(await page.text('main')).includes('Charleston Workshop')) note('kind=WORKSHOP filter does not show the workshop');
  if ((await page.text('main')).includes('Lindy Hop Beginners')) note('kind=WORKSHOP filter still shows the class');
  await page.goto('/en/search?q=charlston');
  await look(page, 'a-search-typo', true);
  if (!(await page.text('main')).includes('Charleston Workshop')) note('search with a typo ("charlston") does not find the workshop');
  await page.goto('/en/calendar?city=madrid');
  await sleep(1500);
  await look(page, 'a-calendar', true);
  if (!(await page.text('main')).includes('Lindy Hop')) note('calendar for Madrid does not show the class');
  await page.goto('/en/map?city=madrid');
  await sleep(4000);
  await look(page, 'a-map', true);
  if (!(await page.text('main')).includes('Lindy Hop Beginners') && !(await page.text('main')).includes('Charleston')) note('map list for Madrid shows none of the two events');
  if (!made.workshopSlug) return;
  await page.goto('/en/events/' + made.workshopSlug);
  const event = await look(page, 'a-event-anonymous', true);
  if (!event.actions.some(text => /sign in/i.test(text))) note('anonymous visitor sees no "sign in to RSVP" on the event');
  await page.click('a.button', 'Sign in').catch(() => undefined);
  const login = await page.url();
  console.log('  sign-in link from the event leads to ' + login);
  if (!login.includes('next=')) note('"Sign in to RSVP" does not carry a return address: after signing in the visitor lands elsewhere and must find the event again');
  await register(page, 'Ana Audit', 'dancer-' + tag + '@example.test', 'Audit-' + randomUUID());
  const afterLogin = await look(page, 'a-after-login', true);
  await page.goto('/en/events/' + made.workshopSlug);
  const noProfile = await look(page, 'a-event-no-profile', true);
  if (!noProfile.actions.some(text => /going/i.test(text))) console.log('  (no RSVP buttons before the profile exists: ' + noProfile.actions.join(', ') + ')');
  void afterLogin;
  await onboard(page, 'FOLLOWER', 'BEGINNER');
  await page.goto('/en/events/' + made.workshopSlug);
  await page.click('.rsvp-buttons button', 'Going').catch(() => note('no "Going" button for a signed-in dancer with a profile'));
  const going = await look(page, 'a-event-going', true);
  if (!/1 going/.test(await page.text('main'))) note('counter did not become "1 going" after answering');
  void going;
  await page.goto('/en/my-events');
  await look(page, 'a-my-events', true);
  if (!(await page.text('main')).includes('Charleston Workshop')) note('the event I am going to is not on "My events"');
  if (made.classSlug) {
    await page.goto('/en/events/' + made.classSlug);
    await look(page, 'a-class-series', true);
  }
  await page.goto('/en/people/' + made.handle);
  await look(page, 'a-school-profile', true);
  await page.goto('/en/partners');
  await look(page, 'a-partners', true);
  await page.goto('/en/feed');
  await look(page, 'a-feed', true);
  await page.goto('/en/notifications');
  await look(page, 'a-notifications', true);
  await page.goto('/en/messages');
  await look(page, 'a-messages', true);
  await page.goto('/en/settings');
  await look(page, 'a-settings', true);
  // Narrow screen: the two most used pages.
  await page.width(390);
  await page.goto('/en/events');
  await look(page, 'a-events-mobile', true);
  await page.goto('/en/events/' + made.workshopSlug);
  await look(page, 'a-event-mobile', true);
  await page.width(1280);
}
async function main() {
  if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(process.env.DATABASE_URL || '').hostname)) throw new Error('Local database only');
  const page = await openBrowser(origin, out);
  try {
    const made = await journeyB(page);
    await journeyA(page, made);
  } catch (error) {
    console.log('\nSTOPPED: ' + (error instanceof Error ? error.message : error));
    await page.shot('stopped').catch(() => undefined);
    console.log(JSON.stringify(await page.describe().catch(() => ({}))));
  } finally {
    console.log('\nJS errors: ' + JSON.stringify([...new Set(page.errors)].slice(0, 20), null, 1));
    console.log('Failed requests: ' + JSON.stringify([...new Set(page.failed)].slice(0, 30)));
    console.log('FINDINGS:\n- ' + findings.join('\n- '));
    await page.close();
    if (!process.env.AUDIT_KEEP) {
      const profiles = await db.profile.findMany({where: {userId: {in: users}}, select: {id: true}});
      await db.event.deleteMany({where: {members: {some: {profileId: {in: profiles.map(p => p.id)}, role: 'OWNER'}}}});
      await db.user.deleteMany({where: {id: {in: users}}});
    } else console.log('kept users: ' + users.join(','));
    await db.$disconnect();
  }
}
main();
