// Captures the two "how to run a school" screenshots shown on the homepage from a locally running build.
//   1. start the app:  BETTER_AUTH_URL=http://localhost:3100 pnpm exec next start --hostname 127.0.0.1 --port 3100
//   2. run:            pnpm exec tsx scripts/guide-screenshots.ts
// It signs up a throwaway account, turns its profile into a school, photographs the profile editor and the
// new-event form through a headless browser, and deletes the account again. Local database only.
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {config} from 'dotenv';
import sharp from 'sharp';
import {db} from '@dance/db';
config({path: '../../.env', quiet: true});
const origin = process.env.GUIDE_ORIGIN || 'http://localhost:3100', port = 9333;
const browsers = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function api(path: string, method: string, body: unknown, cookie = '') {
  const response = await fetch(origin + path, {method, headers: {'Content-Type': 'application/json', Origin: origin, ...(cookie ? {Cookie: cookie} : {})}, body: JSON.stringify(body)});
  if (!response.ok) throw new Error(path + ' → ' + response.status + ' ' + (await response.text()).slice(0, 200));
  return response;
}
async function main() {
  if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(process.env.DATABASE_URL || '').hostname)) throw new Error('Local database only');
  const exe = browsers.find(path => existsSync(path));
  if (!exe) throw new Error('No Chromium-based browser found');
  const tag = randomUUID().slice(0, 8), email = 'guide-' + tag + '@example.test', password = 'Guide-' + randomUUID();
  const city = await db.city.findFirstOrThrow({where: {slug: 'madrid'}});
  let userId = '';
  const profile = await mkdtemp(join(tmpdir(), 'guide-browser-'));
  const browser = spawn(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], {stdio: 'ignore'});
  try {
    await api('/api/auth/sign-up/email', 'POST', {name: 'Swing Studio Madrid', email, password, ageConfirmed: true, locale: 'en'});
    userId = (await db.user.update({where: {email}, data: {emailVerified: true}})).id;
    const cookie = (await api('/api/auth/sign-in/email', 'POST', {email, password})).headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    await api('/api/profile', 'PUT', {name: 'Swing Studio Madrid', handle: 'swing-studio-' + tag, cityId: city.id, type: 'SCHOOL',
      bio: 'Weekly Lindy Hop and solo jazz classes for every level.', district: '', instagram: ''}, cookie);
    let target: {webSocketDebuggerUrl: string} | undefined;
    for (let attempt = 0; attempt < 40 && !target; attempt++) {
      await sleep(250);
      target = await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', {method: 'PUT'}).then(response => response.json()).catch(() => undefined);
    }
    if (!target) throw new Error('Browser did not start');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {socket.onopen = resolve; socket.onerror = reject;});
    let next = 0;
    const waiting = new Map<number, (value: Record<string, never>) => void>();
    socket.onmessage = event => {const message = JSON.parse(String(event.data)); waiting.get(message.id)?.(message.result ?? {}); waiting.delete(message.id);};
    const send = <T = Record<string, never>>(method: string, params: object = {}) => new Promise<T>(resolve => {
      const id = ++next; waiting.set(id, resolve as never); socket.send(JSON.stringify({id, method, params}));});
    await send('Emulation.setDeviceMetricsOverride', {width: 900, height: 1400, deviceScaleFactor: 1.5, mobile: false});
    for (const pair of cookie.split('; ')) {
      const at = pair.indexOf('=');
      await send('Network.setCookie', {name: pair.slice(0, at), value: pair.slice(at + 1), url: origin});
    }
    const out = join(process.cwd(), 'public', 'images', 'guide');
    await mkdir(out, {recursive: true});
    // Each shot is the part of the page around one selector, so the picture shows the control the caption talks about.
    const shots = [
      {file: 'school-profile', path: '/en/profile', selector: 'select[name="type"]', before: 150, height: 300},
      {file: 'school-event', path: '/en/events/new', selector: 'select[name="schoolProfileId"]', before: 150, height: 300}];
    for (const shot of shots) {
      await send('Page.navigate', {url: origin + shot.path});
      await sleep(4000);
      const {result} = await send<{result: {value: number | null}}>('Runtime.evaluate', {returnByValue: true,
        expression: '(()=>{document.querySelectorAll("[class*=install]").forEach(n=>n.remove());const pick=document.querySelector("select[name=schoolProfileId]");if(pick&&pick.options[1]){pick.value=pick.options[1].value;}const e=document.querySelector(' + JSON.stringify(shot.selector) + ');return e?e.getBoundingClientRect().top+scrollY:null})()'});
      if (result.value === null) throw new Error('Not found on ' + shot.path + ': ' + shot.selector);
      const {data} = await send<{data: string}>('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true,
        clip: {x: 0, y: Math.max(0, result.value - shot.before), width: 900, height: shot.height, scale: 1}});
      await sharp(Buffer.from(data, 'base64')).resize({width: 900}).webp({quality: 84}).toFile(join(out, shot.file + '.webp'));
      console.log('saved', shot.file + '.webp');
    }
    socket.close();
  } finally {
    browser.kill();
    if (userId) await db.user.delete({where: {id: userId}}).catch(() => undefined);
    await db.$disconnect();
    await sleep(500);
    await rm(profile, {recursive: true, force: true}).catch(() => undefined);
    void writeFile;
  }
}
main().catch(error => {console.error(error instanceof Error ? error.message : error); process.exitCode = 1;});
