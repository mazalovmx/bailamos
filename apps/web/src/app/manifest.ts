import type {MetadataRoute} from 'next';
import {headers} from 'next/headers';
import {noteLocale, noteText, type NoteLocale} from '../lib/notifications/render';
// There is one manifest URL for all languages. The browser requests it from the page being installed, so the
// language is read from that page's path (Referer), then from Accept-Language; the app then starts in that language.
// "id" stays the same for every language, so it is always one and the same installed app.
function installLocale(referer: string | null, accept: string | null): NoteLocale {
  let path = '';
  try {path = referer ? new URL(referer).pathname : '';} catch {path = '';}
  const fromPath = /^\/(en|es|ru)(\/|$)/.exec(path)?.[1];
  if (fromPath) return noteLocale(fromPath);
  const preferred = (accept || '').split(',').map(part => part.trim().slice(0, 2).toLowerCase()).find(code => code === 'en' || code === 'es' || code === 'ru');
  return noteLocale(preferred);
}
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const request = await headers(), locale = installLocale(request.get('referer'), request.get('accept-language'));
  const t = (key: string) => noteText(locale, key), home = '/' + locale;
  const icon = {sizes: '192x192', type: 'image/png', src: '/icons/icon-192.png'};
  return {id: '/', name: t('appName'), short_name: t('appShortName'), description: t('appDescription'), lang: locale, dir: 'ltr',
    start_url: home + '?source=pwa', scope: '/', display: 'standalone', orientation: 'any',
    background_color: '#f6f4ee', theme_color: '#253b2f', categories: ['social', 'lifestyle', 'entertainment'],
    icons: [
      {...icon, purpose: 'any'},
      {src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any'},
      {src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable'},
      {src: '/icons/apple-touch-icon-180.png', sizes: '180x180', type: 'image/png', purpose: 'any'},
      {src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any'}],
    shortcuts: [
      {name: t('shortcutEvents'), url: home + '/events', icons: [icon]},
      {name: t('shortcutCalendar'), url: home + '/calendar', icons: [icon]},
      {name: t('shortcutMap'), url: home + '/map', icons: [icon]}]};
}
