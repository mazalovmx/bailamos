import './globals.css';
import {I18nProvider} from '../components/i18n';
import {getLocale, messagesFor} from '../lib/i18n';
export const metadata = {title: 'Dance Community · Admin', robots: {index: false, follow: false}};
export default async function Layout({children}: {children: React.ReactNode}) {
  const locale = await getLocale();
  return <html lang={locale}><body><I18nProvider locale={locale} messages={messagesFor(locale)}>{children}</I18nProvider></body></html>;
}
