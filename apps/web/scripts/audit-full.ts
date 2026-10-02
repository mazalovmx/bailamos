// Signed-in audit of a locally running build. Run from apps/web:  pnpm exec tsx scripts/audit-full.ts [outDir]
//   1. crawls every internal link as the .env account, on the site and in the admin panel;
//   2. drives ten scenarios through a headless browser with throwaway accounts (they are deleted afterwards).
// The .env account is only used to read pages and to moderate content created by the throwaway accounts.
import {join} from 'node:path';
import {db} from '@dance/db';
import {openBrowser, sleep, type Page} from './audit-driver';
import {admin, call, cleanup, envAccount, makeAccount, signIn, tag, web} from './audit-auth';
const out = process.argv[2] || join(process.cwd(), '..', '..', 'test-results', 'audit-full');
const findings: string[] = [];
const note = (text: string) => {if (!findings.includes(text)) findings.push(text); console.log('  !! ' + text);};
const ok = (text: string) => console.log('  ok  ' + text);
type Seen = {url: string; title: string; h1: string[]; h2: string[]; notices: string[]; fields: string[]; actions: string[]; overflowX: boolean};
async function look(page: Page, name: string) {
  const seen = await page.describe() as Seen;
  await page.shot(name);
  console.log('[' + name + '] ' + JSON.stringify({url: seen.url, title: seen.title, h1: seen.h1, h2: seen.h2.slice(0, 8), notices: seen.notices, actions: seen.actions.slice(0, 24)}));
  if (seen.overflowX) note(name + ': horizontal overflow at ' + seen.url);
  if (/find your rhythm/.test(seen.title) && !/^\/(en|es|ru)\/?$/.test(seen.url)) note('no page title of its own: ' + seen.url.split('?')[0].replace(/[0-9a-f-]{20,}/, '<id>'));
  if (!seen.h1.length) note('no heading on ' + seen.url);
  return seen;
}
const bad = [/MISSING_MESSAGE/, /\bundefined\b/, /\[object Object\]/, /\bNaN\b/, />null</, /\{[a-zA-Z]+\}/];
async function crawl(label: string, origin: string, cookie: string, starts: string[], limit = 450) {
  const seen = new Map<string, number | string>(), queue = [...starts], problems: string[] = [];
  while (queue.length && seen.size < limit) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    const response = await call(origin, path, 'GET', undefined, cookie).catch(() => null);
    if (!response) {seen.set(path, 'ERR'); problems.push('no answer: ' + path); continue;}
    seen.set(path, response.status);
    if (response.status >= 400) {problems.push(response.status + ' ' + path); continue;}
    if (response.status >= 300) {const to = (response.headers.get('location') || '').replace(origin, ''); if (/\/login/.test(to)) problems.push('signed in but sent to sign-in: ' + path); continue;}
    if (!(response.headers.get('content-type') || '').includes('text/html')) continue;
    const html = await response.text(), body = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, ''), text = body.replace(/<[^>]+>/g, ' ');
    for (const pattern of bad) {const hit = pattern.exec(text); if (hit) problems.push('text "' + text.slice(Math.max(0, hit.index - 40), hit.index + 40).replace(/\s+/g, ' ').trim() + '" on ' + path);}
    if (!/<h1[\s>]/.test(body)) problems.push('no <h1> on ' + path);
    for (const match of body.matchAll(/href="([^"]+)"/g)) {
      let href = match[1].replace(/&amp;/g, '&');
      if (href.startsWith(origin)) href = href.slice(origin.length);
      if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/_next') || href.startsWith('/api/') || /\.(png|webp|svg|ico|css|js|woff2?|xml)(\?|$)/.test(href)) continue;
      href = href.split('#')[0];
      if (href && !seen.has(href) && !queue.includes(href)) queue.push(href);
    }
  }
  console.log('\nCRAWL ' + label + ': ' + seen.size + ' pages, ' + problems.length + ' problems' + (queue.length ? ' (stopped at the limit, ' + queue.length + ' not visited)' : ''));
  for (const problem of [...new Set(problems)].slice(0, 40)) note('[' + label + '] ' + problem);
  return seen;
}
const local = (days: number, hour: number) => {const d = new Date(Date.now() + days * 86400000); d.setUTCHours(hour, 0, 0, 0); return d.toISOString().slice(0, 16);};
async function apiEvent(cookie: string, input: {title: string; kind: string; weekly?: boolean; days: number; schoolProfileId?: string}) {
  const city = await db.city.findFirstOrThrow({where: {slug: 'madrid'}});
  const response = await call(web, '/api/events', 'POST', {title: input.title, description: input.title + '. Friendly group, bring comfortable shoes.', cityId: city.id, styleId: 'lindy-hop',
    kind: input.kind, startsLocal: local(input.days, 19), endsLocal: local(input.days, 20), status: 'PUBLISHED', tagIds: [], recurrenceDays: [],
    recurrenceWeeks: input.weekly ? 4 : 1, schoolProfileId: input.schoolProfileId}, cookie);
  if (!response.ok) throw new Error('event not created: ' + response.status + ' ' + (await response.text()).slice(0, 150));
  return await response.json() as {id: string; slug: string};
}
async function scenario(name: string, run: () => Promise<void>, page: Page) {
  console.log('\n===== ' + name + ' =====');
  try {await run();} catch (error) {
    note(name + ' STOPPED: ' + (error instanceof Error ? error.message : String(error)));
    await page.shot('stopped-' + name.slice(0, 12).replace(/\W+/g, '-')).catch(() => undefined);
    console.log('  at: ' + JSON.stringify(await page.describe().catch(() => ({}))).slice(0, 900));
  }
}
async function main() {
  if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(process.env.DATABASE_URL || '').hostname)) throw new Error('Local database only');
  const owner = envAccount(), ownerWeb = await signIn(web, owner.email, owner.password), ownerAdmin = await signIn(admin, owner.email, owner.password);
  const page = await openBrowser(web, out);
  try {
    // ---- accounts and content the scenarios work with
    const school = await makeAccount('Swing Studio Audit', 'SCHOOL'), ana = await makeAccount('Ana Audit', 'DANCER'), leo = await makeAccount('Leo Audit', 'DANCER');
    const klass = await apiEvent(school.cookie, {title: 'Lindy Hop Beginners ' + tag, kind: 'CLASS', weekly: true, days: 3, schoolProfileId: school.profileId});
    const workshop = await apiEvent(school.cookie, {title: 'Charleston Workshop ' + tag, kind: 'WORKSHOP', days: 10, schoolProfileId: school.profileId});
    const social = await apiEvent(leo.cookie, {title: 'Friday Swing Social ' + tag, kind: 'SOCIAL', days: 6});
    // ---- 1. crawl signed in (AUDIT_SKIP_CRAWL=1 runs the scenarios only)
    if (!process.env.AUDIT_SKIP_CRAWL) {
    const ownerPages = await crawl('site as the .env account', web, ownerWeb, ['/en', '/en/account', '/en/my-events', '/en/profile', '/en/settings', '/en/messages', '/en/notifications',
      '/en/posts', '/en/partners', '/en/partners/matches', '/en/partners/sent', '/en/feed', '/en/events/new', '/en/posts/new', '/en/venues/new', '/en/share', '/ru/account', '/es/account',
      '/en/events/' + klass.slug, '/en/events/' + workshop.slug, '/en/people/' + school.handle, '/en/schools/' + school.handle]);
    void ownerPages;
    await crawl('site as a school owner', web, school.cookie, ['/en/account', '/en/my-events', '/en/events/' + klass.slug + '/edit', '/en/events/' + workshop.slug + '/edit', '/en/schools/' + school.handle, '/en/profile'], 120);
    await crawl('admin panel as the .env account', admin, ownerAdmin, ['/', '/moderation', '/claims', '/schools'], 200);
    }
    // ---- 2. scenarios in the browser
    await scenario('S1 co-organizer invitation', async () => {
      await page.setCookies(school.cookie);
      await page.goto('/en/events/' + klass.slug + '/edit');
      const editor = await look(page, 's1-editor');
      if (!editor.h2.some(text => /organizer/i.test(text))) note('S1: the event editor has no Organizers section');
      await page.fill('section[aria-labelledby=team-title] form input', '@' + ana.handle);
      await page.click('section[aria-labelledby=team-title] form button');
      await sleep(600);
      await look(page, 's1-invited');
      const invite = await db.eventInvite.findFirst({where: {eventId: klass.id, profileId: ana.profileId}});
      if (!invite) {note('S1: sending an invitation by @handle created no invitation'); return;}
      ok('invitation created');
      await page.setCookies(ana.cookie);
      await page.goto('/en/notifications');
      const inbox = await look(page, 's1-ana-notifications');
      if (!(await page.text('main')).includes('Lindy Hop Beginners')) note('S1: the invited person sees no notification about the invitation');
      void inbox;
      await page.click('main a', 'Lindy Hop Beginners').catch(() => page.goto('/en/invites/' + invite.token));
      const invitePage = await look(page, 's1-invite-page');
      if (!invitePage.url.includes('/invites/')) note('S1: the invitation notification does not open the invitation (' + invitePage.url + ')');
      await page.click('button', 'Accept');
      const accepted = await look(page, 's1-accepted');
      if (!await db.eventMembership.findFirst({where: {eventId: klass.id, profileId: ana.profileId, role: 'CO_ORGANIZER'}})) note('S1: accepting did not make a co-organizer');
      else ok('co-organizer added; landed on ' + accepted.url.replace(klass.slug, '<event>'));
      await page.goto('/en/events/' + klass.slug);
      if (!(await page.text('main')).includes('Edit and manage')) note('S1: a co-organizer sees no "Edit and manage" on the event');
    }, page);
    await scenario('S2 single dates and artists', async () => {
      await page.setCookies(school.cookie);
      await page.goto('/en/events/' + klass.slug + '/edit');
      await page.click('button, a', 'Cancel this date');
      await sleep(600);
      await look(page, 's2-date-cancelled');
      const cancelled = await db.eventOccurrence.count({where: {eventId: klass.id, cancelled: true}});
      if (cancelled !== 1) note('S2: "Cancel this date" cancelled ' + cancelled + ' dates'); else ok('one date cancelled');
      await page.fill('section[aria-labelledby=artists-title] form:last-of-type input', 'DJ Audit ' + tag);
      const fields = (await page.describe() as Seen).fields.filter(f => !/tagIds|recurrence|styleIds/.test(f));
      console.log('  editor fields: ' + fields.slice(-12).join(', '));
      await page.click('section[aria-labelledby=artists-title] form:last-of-type button');
      await sleep(600);
      const artist = await db.eventMembership.findFirst({where: {eventId: klass.id, role: 'ARTIST'}, include: {profile: true}});
      if (!artist) note('S2: creating an artist without a profile did not attach anyone'); else {
        ok('stub artist ' + artist.profile.handle);
        await page.setCookies('');
        await page.goto('/en/people/' + artist.profile.handle);
        const stub = await look(page, 's2-stub-profile');
        if (!(await page.text('main')).match(/claim/i)) note('S2: an ownerless profile does not offer to claim it');
        void stub;
      }
      await page.goto('/en/events/' + klass.slug);
      const text = await page.text('main');
      if (!/cancel/i.test(text)) note('S2: the public event page does not show that one date is cancelled');
    }, page);
    await scenario('S3 blog post', async () => {
      await page.setCookies(ana.cookie);
      await page.goto('/en/posts');
      await look(page, 's3-my-posts');
      await page.goto('/en/posts/new');
      const fresh = await look(page, 's3-new-post');
      await page.fill('input[name=title], main input[type=text]', 'My first swing festival ' + tag);
      await page.click('main button', fresh.actions.find(a => /create|start|continue|write|new/i.test(a)) || '');
      await sleep(1500);
      const editor = await look(page, 's3-editor');
      if (!editor.url.includes('/edit')) {note('S3: creating a post does not open the editor (' + editor.url + ')'); return;}
      await page.click('.ProseMirror, [contenteditable=true]');
      await page.focus('.ProseMirror, [contenteditable=true]');
      await page.type('Three days of Lindy Hop, live bands every night and a lot of new friends. I am already counting the days to the next one.');
      await sleep(3500);
      await look(page, 's3-typed');
      await page.click('button', 'Save and publish');
      await sleep(1500);
      const published = await look(page, 's3-after-publish');
      const post = await db.post.findFirst({where: {profileId: ana.profileId}, select: {publishedAt: true, slug: true}});
      console.log('  post in DB: ' + JSON.stringify(post) + '; notices: ' + published.notices.join(' | '));
      if (post?.publishedAt && post.slug) {
        await page.setCookies('');
        await page.goto('/en/people/' + ana.handle + '/posts/' + post.slug);
        await look(page, 's3-public-post');
        const rss = await call(web, '/api/feeds/rss/' + ana.handle, 'GET');
        if (!rss.ok || !(await rss.text()).includes('<item>')) note('S3: the author\'s RSS feed has no item for the published post');
      } else note('S3: publishing an empty post — check the notice the editor shows: "' + published.notices.join(' | ') + '"');
    }, page);
    await scenario('S4 follow and feed', async () => {
      await page.setCookies(ana.cookie);
      await page.goto('/en/people/' + school.handle);
      await page.click('button', 'Follow');
      await sleep(500);
      const followed = await look(page, 's4-followed');
      if (!await db.follow.findFirst({where: {userId: ana.id, profileId: school.profileId}})) note('S4: Follow on a profile did nothing'); else ok('following the school');
      void followed;
      await page.goto('/en/cities/madrid');
      await page.click('button', 'Follow').catch(() => note('S4: no Follow button on the city page'));
      await page.goto('/en/feed');
      await look(page, 's4-feed');
      const feed = await page.text('main');
      if (!feed.includes('Charleston Workshop')) note('S4: the feed of someone following the school and the city does not show the school\'s workshop');
      await page.setCookies(school.cookie);
      await page.goto('/en/notifications');
      await look(page, 's4-school-notifications');
      if (!/Ana Audit/.test(await page.text('main'))) note('S4: the school got no "new follower" notification');
    }, page);
    await scenario('S5 messages', async () => {
      await page.setCookies(ana.cookie);
      await page.goto('/en/people/' + leo.handle);
      await page.click('.profile-actions button, .profile-actions a', 'Message');
      await sleep(1500);
      const thread = await look(page, 's5-ana-thread');
      if (!thread.url.includes('/messages/')) {note('S5: "Message" on a profile does not open a conversation (' + thread.url + ')'); return;}
      await page.fill('[id="chat-text"],[name="chat-text"]', 'Hi Leo! Are you going to the Friday social?');
      await page.click('button', 'Send');
      await sleep(800);
      await look(page, 's5-ana-sent');
      await page.setCookies(leo.cookie);
      await page.goto('/en/messages');
      const inbox = await look(page, 's5-leo-inbox');
      if (!/request/i.test((await page.text('main')))) note('S5: a message from a stranger is not shown as a request');
      void inbox;
      await page.click('main a', 'Ana Audit');
      await sleep(800);
      await look(page, 's5-leo-request');
      await page.click('button', 'Accept');
      await sleep(2500);
      await page.fill('[id="chat-text"],[name="chat-text"]', 'Yes! See you there.');
      await sleep(300);
      await page.click('button', 'Send');
      await sleep(800);
      await look(page, 's5-leo-replied');
      const count = await db.message.count({where: {sender: {userId: {in: [ana.id, leo.id]}}}});
      if (count !== 2) note('S5: expected 2 messages in the conversation, found ' + count); else ok('request accepted, reply sent');
      await page.goto('/en/notifications');
      await page.setCookies(ana.cookie);
      await page.goto('/en/notifications');
      await look(page, 's5-ana-notifications');
      // A notification is deliberately not created while the recipient was in the conversation a moment ago;
      // what must always work is the unread counter.
      const unread = await (await call(web, '/api/chat/unread', 'GET', undefined, ana.cookie)).json() as {total: number};
      if (!(unread.total >= 1)) note('S5: the reply does not count as unread for the recipient'); else ok('reply counted as unread (' + unread.total + ')');
    }, page);
    await scenario('S6 partner search', async () => {
      for (const who of [ana, leo]) {
        const saved = await call(web, '/api/profile/skills', 'PUT', {skills: [{styleId: 'lindy-hop', role: who === leo ? 'LEADER' : 'FOLLOWER', level: 'INTERMEDIATE', lookingFor: true}]}, who.cookie);
        if (!saved.ok) throw new Error('skills not saved: ' + saved.status);
      }
      await page.setCookies(ana.cookie);
      await page.goto('/en/partners');
      const search = await look(page, 's6-search');
      if (!(await page.text('main')).includes('Leo Audit')) {note('S6: a compatible partner in the same city who opted in is not found'); console.log('  ' + JSON.stringify(search.notices)); return;}
      await page.click('main button', 'nterest').catch(async () => note('S6: no interest button on the candidate card; actions: ' + (await page.describe() as Seen).actions.join(', ').slice(0, 300)));
      await sleep(600);
      await look(page, 's6-interest-sent');
      await page.goto('/en/partners/sent');
      if (!(await page.text('main')).includes('Leo Audit')) note('S6: sent interest is not listed on "Sent interest"');
      await page.setCookies(leo.cookie);
      await page.goto('/en/partners');
      await page.click('main button', 'nterest').catch(() => undefined);
      await sleep(600);
      await page.goto('/en/partners/matches');
      await look(page, 's6-leo-matches');
      if (!(await page.text('main')).includes('Ana Audit')) note('S6: mutual interest does not appear under "Mutual matches"'); else ok('mutual match');
      await page.goto('/en/notifications');
      if (!/Mutual interest/i.test(await page.text('main'))) note('S6: no notification about the mutual match');
    }, page);
    await scenario('S7 report and moderation', async () => {
      await page.setCookies(ana.cookie);
      await page.goto('/en/events/' + social.slug);
      await page.click('button', 'Report');
      await sleep(400);
      await page.fill('select[name=reason]', 'SPAM');
      await page.fill('textarea[name=comment]', 'Audit report: please ignore.');
      await look(page, 's7-report-dialog');
      await page.click('dialog button, .report-dialog button', 'Send').catch(() => page.click('dialog button[type=submit], .report-dialog button.button'));
      await sleep(700);
      await look(page, 's7-report-sent');
      const report = await db.report.findFirst({where: {reporterUserId: ana.id, targetId: social.id}});
      if (!report) {note('S7: the report dialog did not create a report'); return;}
      ok('report filed');
      const queue = await call(admin, '/moderation', 'GET', undefined, ownerAdmin), queueHtml = await queue.text();
      if (!queue.ok) note('S7: admin moderation queue answers ' + queue.status);
      const adminPage = await openBrowser(admin, out, 9445);
      try {
        await adminPage.setCookies(ownerAdmin);
        await adminPage.goto('/');
        await look(adminPage, 's7-admin-dashboard');
        await adminPage.goto('/moderation');
        await sleep(1500);
        const mod = await look(adminPage, 's7-admin-queue');
        if (!(await adminPage.text('main, body')).includes('Friday Swing Social')) note('S7: the report is not visible in the admin moderation queue');
        console.log('  admin actions: ' + mod.actions.join(', ').slice(0, 400) + (queueHtml.length ? '' : ''));
        await adminPage.goto('/claims'); await look(adminPage, 's7-admin-claims');
        await adminPage.goto('/schools'); await look(adminPage, 's7-admin-schools');
        await adminPage.goto('/r/events'); await sleep(1200); await look(adminPage, 's7-admin-events');
        await adminPage.goto('/r/users'); await sleep(1200); await look(adminPage, 's7-admin-users');
        await adminPage.goto('/r/audit-log'); await sleep(1200); await look(adminPage, 's7-admin-audit');
        console.log('  admin JS errors: ' + JSON.stringify([...new Set(adminPage.errors)].slice(0, 8)) + ' failed: ' + JSON.stringify([...new Set(adminPage.failed)].slice(0, 8)));
        if (adminPage.errors.length) note('admin panel console errors: ' + [...new Set(adminPage.errors)].slice(0, 3).join(' | ').slice(0, 300));
      } finally {await adminPage.close();}
    }, page);
    await scenario('S8 settings and data', async () => {
      await page.setCookies(leo.cookie);
      await page.goto('/en/settings');
      await look(page, 's8-settings');
      const exported = await call(web, '/api/account/export', 'GET', undefined, leo.cookie);
      const data = exported.ok ? await exported.json() as Record<string, unknown> : null;
      if (!data) note('S8: data export answers ' + exported.status); else ok('export keys: ' + Object.keys(data).join(', ').slice(0, 200));
      await page.goto('/en/profile');
      await look(page, 's8-profile');
      await page.goto('/en/my-events');
      await look(page, 's8-my-events');
    }, page);
    await scenario('S9 announcement parser', async () => {
      await page.setCookies(leo.cookie);
      await page.goto('/en/events/new');
      const form = await look(page, 's9-new-event');
      if (!(await page.exists('.parse-panel'))) {console.log('  parser panel is not shown (no model key in this build)'); return;}
      await page.fill('.parse-panel textarea', 'SWING NIGHT 🎷 Saturday 21:00 at Café Central, Plaza del Ángel 10, Madrid. Lindy hop social with DJ Marta, all levels welcome. Entry 8 €. Every week!');
      await page.click('.parse-panel button', 'Fill in the form');
      await sleep(9000);
      const parsed = await look(page, 's9-parsed');
      const title = (parsed.fields.find(f => f.startsWith('title')) || ''), starts = parsed.fields.find(f => f.startsWith('startsLocal')) || '';
      console.log('  parsed: ' + title + ' | ' + starts + ' | notices: ' + parsed.notices.join(' | ').slice(0, 400));
      if (!/title\*=.+/.test(title)) note('S9: the parser did not fill in the title (notices: ' + parsed.notices.join(' | ').slice(0, 200) + ')');
      if (!/startsLocal\*=\d{4}/.test(starts)) note('S9: the parser did not fill in the start time');
      void form;
    }, page);
    await scenario('S10 sharing, calendar files, short link, mobile', async () => {
      await page.setCookies('');
      const event = await db.event.findUniqueOrThrow({where: {id: workshop.id}, select: {shortCode: true}});
      const short = await call(web, '/e/' + event.shortCode, 'GET');
      if (short.status !== 308 && short.status !== 307) note('S10: the short link /e/<code> answers ' + short.status); else ok('short link → ' + (short.headers.get('location') || '').replace(workshop.slug, '<event>'));
      const ics = await call(web, '/api/events/' + workshop.id + '/ics', 'GET');
      if (!ics.ok || !(await ics.text()).includes('BEGIN:VEVENT')) note('S10: the .ics file of an event is broken (' + ics.status + ')');
      const feedIcs = await call(web, '/api/feeds/ical?city=madrid', 'GET');
      if (!feedIcs.ok || !(await feedIcs.text()).includes('Charleston Workshop')) note('S10: the city calendar feed does not contain the workshop');
      await page.goto('/en/share');
      await look(page, 's10-share-studio');
      await page.width(390);
      for (const [name, path] of [['home', '/en'], ['calendar', '/en/calendar?city=madrid'], ['classes', '/en/classes?city=madrid'], ['school', '/en/schools/' + school.handle], ['search', '/en/search?q=lindy'], ['login', '/en/login'], ['register', '/en/register']] as const) {
        await page.goto(path); await sleep(600); await look(page, 's10-mobile-' + name);
      }
      await page.setCookies(ana.cookie);
      for (const [name, path] of [['messages', '/en/messages'], ['settings', '/en/settings'], ['new-event', '/en/events/new'], ['partners', '/en/partners'], ['profile', '/en/profile']] as const) {
        await page.goto(path); await sleep(600); await look(page, 's10-mobile-' + name);
      }
      await page.click('.site-menu-all summary');
      await page.shot('s10-mobile-menu-open');
      await page.width(1280);
    }, page);
  } finally {
    console.log('\nJS errors: ' + JSON.stringify([...new Set(page.errors)].slice(0, 20), null, 1));
    console.log('Failed requests: ' + JSON.stringify([...new Set(page.failed)].slice(0, 30)));
    console.log('FINDINGS (' + findings.length + '):\n- ' + findings.join('\n- '));
    await page.close();
    await cleanup();
  }
}
main().catch(error => {console.error('AUDIT FAILED: ' + (error instanceof Error ? error.message : error)); process.exitCode = 1;});
