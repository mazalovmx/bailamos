import {loginPath} from '../../../lib/login-path';
import {getTranslations} from 'next-intl/server';
import {redirect} from 'next/navigation';
import Link from 'next/link';
import {currentUser} from '../../../lib/session';
import {listNotifications, unreadCount} from '../../../lib/notifications/center';
import {NotificationList} from '../../../components/notifications/list';
import '../../styles/notifications.css';
export async function generateMetadata() {
  const t = await getTranslations('Notifications');
  return {title: t('title'), robots: {index: false}};
}
export default async function Notifications({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params, user = await currentUser();
  if (!user) redirect(loginPath(locale, '/notifications'));
  const t = await getTranslations('Notifications');
  const [page, unread] = await Promise.all([listNotifications(user.id, locale), unreadCount(user.id)]);
  return <main className="form-page note-page"><h1>{t('title')}</h1><p className="intro">{t('intro')}</p>
    <NotificationList initial={{...page, unread}}/>
    <p className="note-settings"><Link href={'/' + locale + '/settings#notifications-title'}>{t('settingsLink')}</Link></p>
  </main>;
}
