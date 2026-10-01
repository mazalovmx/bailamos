import {hasLocale, NextIntlClientProvider} from 'next-intl';
import {setRequestLocale} from 'next-intl/server';
import {notFound} from 'next/navigation';
import {routing} from '../../i18n/routing';
import {Header} from '../../components/header';
import {currentUser} from '../../lib/session';
import {getTranslations} from 'next-intl/server';
import '../globals.css';
import '../application.css';
import '../swing.css';
import '../community.css';
import '../mobile-controls.css';
export const dynamic = 'force-dynamic';
export async function generateMetadata({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  const t = await getTranslations({locale, namespace: 'Home'});
  return {title: {default: t('title'), template: '%s · Dance Community'}, description: t('description')};
}
export default async function Layout({children, params}: {
  children: React.ReactNode; params: Promise<{locale: string}>;
}) {
  const {locale} = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const user = await currentUser(), t = await getTranslations('App');
  return <html lang={locale}><body><NextIntlClientProvider>
    <Header signedIn={!!user}/>{children}<footer className="app-footer"><span>dance community</span><p>{t('footer')}</p></footer>
  </NextIntlClientProvider></body></html>;
}
