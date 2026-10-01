import {hasLocale, NextIntlClientProvider} from 'next-intl';
import {setRequestLocale} from 'next-intl/server';
import {notFound} from 'next/navigation';
import {routing} from '../../i18n/routing';
import {Header} from '../../components/header';
import {RegisterSw} from '../../components/pwa/register-sw';
import {InstallPrompt} from '../../components/pwa/install-prompt';
import {currentUser} from '../../lib/session';
import {siteUrl} from '../../lib/mail';
import {getTranslations} from 'next-intl/server';
// Registers push delivery so that notify() reaches subscribed devices.
import '../../lib/notifications/register';
import '../globals.css';
import '../application.css';
import '../swing.css';
import '../community.css';
import '../mobile-controls.css';
import '../navigation.css';
import '../home-actions.css';
export const dynamic = 'force-dynamic';
export const viewport = {themeColor: '#253b2f'};
export async function generateMetadata({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  const t = await getTranslations({locale, namespace: 'Home'});
  return {metadataBase: new URL(siteUrl()), title: {default: t('title'), template: '%s · Dance Community'}, description: t('description'),
    icons: {apple: '/icons/apple-touch-icon-180.png'}, appleWebApp: {capable: true, title: 'Dance', statusBarStyle: 'default' as const}};
}
export default async function Layout({children, params}: {
  children: React.ReactNode; params: Promise<{locale: string}>;
}) {
  const {locale} = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const user = await currentUser(), t = await getTranslations('App'), account = await getTranslations('Account');
  return <html lang={locale}><body><NextIntlClientProvider>
    <Header signedIn={!!user}/>{children}<footer className="app-footer"><span>dance community</span><p>{t('footer')}</p>
      <a href={'/' + locale + '/privacy'}>{account('privacyLink')}</a></footer>
    <RegisterSw signedIn={!!user}/><InstallPrompt/>
  </NextIntlClientProvider></body></html>;
}
