import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import {lookup} from 'node:dns/promises';
import {BlockList, isIP} from 'node:net';
import {setTimeout as sleep} from 'node:timers/promises';
// The only way the importer talks to the outside world. Feed addresses are entered by staff but point at third-party
// hosts, so every hop is checked: http(s) only, no credentials, usual web ports, and no address that resolves to a
// private, loopback, link-local or cloud-metadata range. The connection is then made to exactly the checked addresses,
// which closes the DNS-rebinding gap between "check" and "connect".
export class ImportFetchError extends Error {
  constructor(public code: string, public status?: number) {super(code);}
}
export type Address = {address: string; family: number};
const v4 = new BlockList(), v6 = new BlockList(), mapped = new BlockList();
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) v4.addSubnet(net, prefix, 'ipv4');
// Unspecified and loopback, unique-local, link-local, site-local, multicast, documentation, NAT64, 6to4 and Teredo.
for (const [net, prefix] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['2001:db8::', 32],
  ['64:ff9b::', 96], ['2002::', 16], ['2001::', 32]] as const) v6.addSubnet(net, prefix, 'ipv6');
mapped.addSubnet('::ffff:0:0', 96, 'ipv6');
export function isPrivateAddress(input: string): boolean {
  const ip = input.replace(/^\[|\]$/g, '').replace(/%.*$/, ''), family = isIP(ip);
  if (family === 4) return v4.check(ip, 'ipv4');
  if (family !== 6) return true;
  if (mapped.check(ip, 'ipv6')) {
    // IPv4-mapped: judge the embedded IPv4 address, whichever way it is written.
    const match = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(ip);
    if (!match) return true;
    if (match[1]) return isPrivateAddress(match[1]);
    const high = parseInt(match[2], 16), low = parseInt(match[3], 16);
    return isPrivateAddress([high >> 8, high & 255, low >> 8, low & 255].join('.'));
  }
  return v6.check(ip, 'ipv6');
}
export type Resolver = (hostname: string) => Promise<Address[]>;
export type TransportResponse = {status: number; headers: Record<string, string | undefined>; body: Buffer};
export type Transport = (url: URL, options: {headers: Record<string, string>; addresses: Address[]; timeoutMs: number; maxBytes: number}) => Promise<TransportResponse>;
const PORTS = new Set(['', '80', '443', '8080', '8443']);
const LOCAL_NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa)$/;
const systemResolver: Resolver = async hostname => lookup(hostname, {all: true, verbatim: true});
// Throws unless the address is a public http(s) endpoint; returns the addresses the connection may use.
export async function assertPublicUrl(url: URL, resolve: Resolver = net.resolve): Promise<Address[]> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ImportFetchError('BAD_SCHEME');
  if (url.username || url.password) throw new ImportFetchError('BAD_URL');
  if (!PORTS.has(url.port)) throw new ImportFetchError('BAD_PORT');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host || LOCAL_NAMES.test(host)) throw new ImportFetchError('PRIVATE_ADDRESS');
  const family = isIP(host);
  let addresses: Address[];
  if (family) addresses = [{address: host, family}];
  else {
    try {addresses = await resolve(host);} catch {throw new ImportFetchError('DNS_FAILED');}
  }
  if (!addresses.length) throw new ImportFetchError('DNS_FAILED');
  // One private record is enough to refuse: a host that answers with both is trying something.
  if (addresses.some(entry => isPrivateAddress(entry.address))) throw new ImportFetchError('PRIVATE_ADDRESS');
  return addresses;
}
const nodeTransport: Transport = (url, {headers, addresses, timeoutMs, maxBytes}) => new Promise((resolve, reject) => {
  const client = url.protocol === 'https:' ? https : http;
  let settled = false;
  const finish = (error: Error | null, value?: TransportResponse) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) {request.destroy(); reject(error);} else resolve(value!);
  };
  const request = client.request(url, {method: 'GET', headers, agent: false,
    // Connect only to the addresses that passed the check above.
    lookup: ((_host: string, options: {all?: boolean}, callback: (...args: unknown[]) => void) =>
      options?.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family)) as never
  }, response => {
    const status = response.statusCode || 0, plainHeaders: Record<string, string | undefined> = {};
    for (const [name, value] of Object.entries(response.headers)) plainHeaders[name] = Array.isArray(value) ? value[0] : value;
    if (status !== 200) {response.resume(); return finish(null, {status, headers: plainHeaders, body: Buffer.alloc(0)});}
    if (Number(plainHeaders['content-length']) > maxBytes) return finish(new ImportFetchError('TOO_LARGE'));
    const encoding = (plainHeaders['content-encoding'] || '').toLowerCase();
    const stream = encoding === 'gzip' || encoding === 'x-gzip' ? response.pipe(zlib.createGunzip())
      : encoding === 'deflate' ? response.pipe(zlib.createInflate()) : encoding === 'br' ? response.pipe(zlib.createBrotliDecompress()) : response;
    const chunks: Buffer[] = [];
    let size = 0;
    // The limit applies to the decoded body, so a small compressed answer cannot expand without bound.
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) finish(new ImportFetchError('TOO_LARGE')); else chunks.push(chunk);
    });
    stream.on('end', () => finish(null, {status, headers: plainHeaders, body: Buffer.concat(chunks)}));
    stream.on('error', () => finish(new ImportFetchError('BAD_BODY')));
    response.on('error', () => finish(new ImportFetchError('NETWORK')));
  });
  const timer = setTimeout(() => finish(new ImportFetchError('TIMEOUT')), timeoutMs);
  request.on('error', error => finish(error instanceof ImportFetchError ? error : new ImportFetchError('NETWORK')));
  request.end();
});
const number = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 && process.env[name]?.trim() ? value : fallback;
};
// Tests replace the resolver and the transport; production never calls this.
const net: {resolve: Resolver; transport: Transport; delayMs: number | null} = {resolve: systemResolver, transport: nodeTransport, delayMs: null};
export function setImportNet(next: Partial<typeof net> | null) {
  Object.assign(net, next || {resolve: systemResolver, transport: nodeTransport, delayMs: null});
  if (!next) lastHit.clear();
}
export const importUserAgent = () => process.env.IMPORT_USER_AGENT?.trim()
  || 'dance-community-importer/0.1 (+' + new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000').origin + ')';
// At most one request per host every IMPORT_HOST_DELAY_MS (2 s) from this process.
const lastHit = new Map<string, number>();
async function polite(host: string) {
  const delay = net.delayMs ?? number('IMPORT_HOST_DELAY_MS', 2000), wait = (lastHit.get(host) || 0) + delay - Date.now();
  if (lastHit.size > 2000) lastHit.clear();
  lastHit.set(host, Date.now() + Math.max(wait, 0));
  if (wait > 0) await sleep(wait);
}
function decode(body: Buffer, contentType: string | undefined) {
  const label = /charset=["']?([\w-]+)/i.exec(contentType || '')?.[1]
    || /^<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(body.subarray(0, 200).toString('latin1'))?.[1] || 'utf-8';
  try {return new TextDecoder(label).decode(body);} catch {return new TextDecoder('utf-8').decode(body);}
}
export type FetchOptions = {etag?: string | null; lastModified?: string | null; accept?: string; timeoutMs?: number; maxBytes?: number};
export type FetchResult = {status: number; notModified: boolean; body: string; etag: string | null; lastModified: string | null; url: string};
const MAX_REDIRECTS = 3;
export async function safeFetch(address: string, options: FetchOptions = {}): Promise<FetchResult> {
  let url: URL;
  try {url = new URL(address);} catch {throw new ImportFetchError('BAD_URL');}
  const timeoutMs = options.timeoutMs ?? number('IMPORT_TIMEOUT_MS', 15_000), maxBytes = options.maxBytes ?? number('IMPORT_MAX_BYTES', 2 * 1024 * 1024);
  const deadline = Date.now() + timeoutMs * 2;
  for (let hop = 0; ; hop++) {
    const addresses = await assertPublicUrl(url);
    await polite(url.hostname);
    const headers: Record<string, string> = {'User-Agent': importUserAgent(), Accept: options.accept || '*/*', 'Accept-Encoding': 'gzip, deflate, br'};
    if (options.etag) headers['If-None-Match'] = options.etag;
    if (options.lastModified) headers['If-Modified-Since'] = options.lastModified;
    const response = await net.transport(url, {headers, addresses, timeoutMs: Math.max(1000, Math.min(timeoutMs, deadline - Date.now())), maxBytes});
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;
      if (!location) throw new ImportFetchError('BAD_REDIRECT', response.status);
      if (hop >= MAX_REDIRECTS) throw new ImportFetchError('TOO_MANY_REDIRECTS');
      try {url = new URL(location, url);} catch {throw new ImportFetchError('BAD_REDIRECT');}
      continue;
    }
    if (response.status === 304) return {status: 304, notModified: true, body: '', etag: options.etag ?? null, lastModified: options.lastModified ?? null, url: url.toString()};
    if (response.status !== 200) throw new ImportFetchError('HTTP_' + response.status, response.status);
    if (response.body.length > maxBytes) throw new ImportFetchError('TOO_LARGE');
    return {status: 200, notModified: false, body: decode(response.body, response.headers['content-type']), url: url.toString(),
      etag: response.headers.etag?.slice(0, 200) ?? null, lastModified: response.headers['last-modified']?.slice(0, 100) ?? null};
  }
}
