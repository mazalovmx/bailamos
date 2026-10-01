import {getLocale, getTranslations} from 'next-intl/server';
import {feedPath, siteOrigin} from '../../lib/calendar/links';
import '../../app/styles/calendar.css';
// Server component. Shows the subscription address of the city/style feed and a webcal:// link that opens the
// visitor's calendar application. `name` is an optional human label of the selection ("Madrid · Lindy Hop").
export async function SubscribeFeed({citySlug, styleSlug, name}: {citySlug?: string; styleSlug?: string; name?: string}) {
  const [t, locale] = await Promise.all([getTranslations('Calendar'), getLocale()]);
  const url = siteOrigin() + feedPath({citySlug, styleSlug, locale}), webcal = url.replace(/^https?:/, 'webcal:');
  return <section className="subscribe-feed" aria-labelledby="subscribe-feed-title">
    <h2 id="subscribe-feed-title">{t('subscribeTitle')}</h2>
    <p>{t('subscribeText')}</p>
    <p className="subscribe-scope">{t('subscribeScope', {name: name || t('feedAll')})}</p>
    <label>{t('feedUrl')}<input readOnly value={url} dir="ltr" spellCheck={false}/></label>
    <div className="add-to-calendar">
      <a className="button secondary" href={webcal}>{t('subscribeWebcal')}</a>
      <a className="button secondary" href={'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcal)} target="_blank" rel="noopener noreferrer">{t('subscribeGoogle')}<span aria-hidden="true"> ↗</span></a>
    </div>
  </section>;
}
