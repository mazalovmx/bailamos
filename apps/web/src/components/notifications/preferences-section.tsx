import {getTranslations} from 'next-intl/server';
import {getPreferences} from '../../lib/notifications/center';
import {pushEnabled} from '../../lib/notifications/push';
import {NotificationPreferences} from './preferences';
import '../../app/styles/notifications.css';
// Server wrapper for the settings page: loads the stored switches and renders the section.
export async function NotificationPreferencesSection({userId}: {userId: string}) {
  const t = await getTranslations('Notifications');
  return <section className="account-section" aria-labelledby="notifications-title"><h2 id="notifications-title">{t('prefsTitle')}</h2>
    <p>{t('prefsText')}</p>
    <NotificationPreferences initial={await getPreferences(userId)} pushConfigured={pushEnabled()}/>
  </section>;
}
