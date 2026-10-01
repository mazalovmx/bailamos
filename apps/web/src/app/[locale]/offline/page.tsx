import {getTranslations} from 'next-intl/server';
import {Retry} from '../../../components/pwa/retry';
import '../../styles/notifications.css';
export async function generateMetadata() {
  const t = await getTranslations('Notifications');
  return {title: t('offlineTitle'), robots: {index: false}};
}
// Shown by the service worker when a page is neither reachable nor saved. It is precached without cookies.
export default async function Offline({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params, t = await getTranslations('Notifications');
  return <main className="form-page narrow offline-page"><h1>{t('offlineTitle')}</h1><p className="intro">{t('offlineText')}</p>
    <div className="offline-actions"><Retry label={t('offlineRetry')}/>
      {/* A plain link: a full navigation is what the service worker can answer from its cache. */}
      <a className="button secondary" href={'/' + locale + '/events'}>{t('offlineEvents')}</a></div>
  </main>;
}
