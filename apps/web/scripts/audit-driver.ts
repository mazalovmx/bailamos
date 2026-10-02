// Minimal headless-browser driver for UX audits of a locally running build (Chrome DevTools Protocol, no dependencies).
// Used by scripts/audit-journeys.ts. Local use only.
import {spawn, type ChildProcess} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const browsers = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'];
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export type Page = Awaited<ReturnType<typeof openBrowser>>;
export async function openBrowser(origin: string, outDir: string, port = 9444, width = 1280) {
  const exe = browsers.find(path => existsSync(path));
  if (!exe) throw new Error('No Chromium-based browser found');
  const profile = await mkdtemp(join(tmpdir(), 'audit-browser-'));
  const child: ChildProcess = spawn(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], {stdio: 'ignore'});
  let target: {webSocketDebuggerUrl: string} | undefined;
  for (let attempt = 0; attempt < 60 && !target; attempt++) {
    await sleep(250);
    target = await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', {method: 'PUT'}).then(response => response.json()).catch(() => undefined);
  }
  if (!target) throw new Error('Browser did not start');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {socket.onopen = resolve; socket.onerror = reject;});
  let next = 0;
  const waiting = new Map<number, (value: never) => void>(), errors: string[] = [], failed: string[] = [];
  let lastUrl = '';
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.id) {waiting.get(message.id)?.((message.result ?? {error: message.error}) as never); waiting.delete(message.id); return;}
    if (message.method === 'Page.frameNavigated' && !message.params.frame.parentId) lastUrl = String(message.params.frame.url).replace(origin, '');
    if (message.method === 'Runtime.exceptionThrown') errors.push('exception on ' + lastUrl + ': ' + (message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text).slice(0, 300));
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push('console: ' + String(message.params.entry.text).slice(0, 300) + ' ' + (message.params.entry.url || ''));
    if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) failed.push(message.params.response.status + ' ' + message.params.response.url.replace(origin, ''));
  };
  const send = <T = Record<string, unknown>>(method: string, params: object = {}) => new Promise<T>(resolve => {
    const id = ++next; waiting.set(id, resolve as never); socket.send(JSON.stringify({id, method, params}));});
  await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {width, height: 900, deviceScaleFactor: 1, mobile: width < 600});
  await mkdir(outDir, {recursive: true});
  const evaluate = async <T>(expression: string) => {
    const reply = await send<{result: {value: T}; exceptionDetails?: {text: string}}>('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (reply.exceptionDetails) throw new Error('evaluate failed: ' + reply.exceptionDetails.text + ' in ' + expression.slice(0, 120));
    return reply.result.value;
  };
  const settle = async () => {await sleep(900); for (let i = 0; i < 20; i++) {if (await evaluate<string>('document.readyState') === 'complete') break; await sleep(200);} await sleep(500);};
  let step = 0;
  const page = {
    errors, failed,
    async goto(path: string) {await send('Page.navigate', {url: origin + path}); await settle();},
    url: () => evaluate<string>('location.pathname + location.search'),
    settle,
    // Sets a control the way a user would, so React-controlled inputs notice.
    async fill(selector: string, value: string) {
      const ok = await evaluate<boolean>(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;
        const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});
        e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
      if (!ok) throw new Error('fill: not found ' + selector);
    },
    async check(selector: string, on = true) {
      const ok = await evaluate<boolean>(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;if(e.checked!==${on})e.click();return true})()`);
      if (!ok) throw new Error('check: not found ' + selector);
    },
    // Clicks the first visible element matching the selector, optionally the one whose text contains `text`.
    async click(selector: string, text?: string) {
      const ok = await evaluate<boolean>(`(()=>{const all=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>e.offsetParent!==null||e.tagName==='SUMMARY');
        const e=${text ? `all.find(e=>e.textContent.includes(${JSON.stringify(text)}))` : 'all[0]'};if(!e)return false;e.scrollIntoView({block:'center'});e.click();return true})()`);
      if (!ok) throw new Error('click: not found ' + selector + (text ? ' "' + text + '"' : ''));
      await settle();
    },
    exists: (selector: string) => evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`),
    text: (selector: string) => evaluate<string>(`(document.querySelector(${JSON.stringify(selector)})?.innerText||'').trim()`),
    // A compact description of what the user sees: heading, notices, form controls, actions.
    async describe() {
      return evaluate<Record<string, unknown>>(`(()=>{const vis=e=>e.offsetParent!==null;const t=e=>(e.innerText||e.value||'').trim().replace(/\\s+/g,' ').slice(0,90);
        const main=document.querySelector('main')||document.body;
        return {url:location.pathname+location.search,title:document.title,h1:[...document.querySelectorAll('h1')].map(t),
          h2:[...main.querySelectorAll('h2')].filter(vis).map(t).slice(0,14),
          notices:[...document.querySelectorAll('[role=alert],[role=status],.notice,.form-error')].filter(vis).map(t).filter(Boolean).slice(0,8),
          fields:[...main.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(vis).map(e=>(e.name||e.id||e.type)+(e.required?'*':'')+'='+String(e.type==='checkbox'?e.checked:e.value).slice(0,40)).slice(0,60),
          actions:[...main.querySelectorAll('button,a.button,summary')].filter(vis).map(t).filter(Boolean).slice(0,40),
          overflowX:document.documentElement.scrollWidth>innerWidth+1}})()`);
    },
    async shot(name: string) {
      const {data} = await send<{data: string}>('Page.captureScreenshot', {format: 'jpeg', quality: 62, captureBeyondViewport: true});
      const file = join(outDir, String(++step).padStart(2, '0') + '-' + name + '.jpg');
      await writeFile(file, Buffer.from(data, 'base64'));
      return file;
    },
    async width(value: number) {await send('Emulation.setDeviceMetricsOverride', {width: value, height: 900, deviceScaleFactor: 1, mobile: value < 600});},
    // Signs the browser in as another account: replaces all cookies with the given Cookie header.
    async setCookies(header: string) {
      await send('Network.clearBrowserCookies');
      for (const pair of header.split('; ').filter(Boolean)) {const at = pair.indexOf('='); await send('Network.setCookie', {name: pair.slice(0, at), value: pair.slice(at + 1), url: origin});}
    },
    // Types into the focused element, as the keyboard would (rich-text editors ignore programmatic value changes).
    focus: (selector: string) => evaluate<boolean>(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const g=getSelection();g.removeAllRanges();g.addRange(r);return true})()`),
    async type(text: string) {await send('Input.insertText', {text}); await sleep(200);},
    async close() {socket.close(); child.kill(); await sleep(400); await rm(profile, {recursive: true, force: true}).catch(() => undefined);}
  };
  return page;
}
