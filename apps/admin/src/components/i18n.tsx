'use client';
import {createContext, useContext, useMemo} from 'react';
import {useRouter} from 'next/navigation';
import {locales, translator} from '../lib/format';
type Value = {locale: string; messages: Record<string, string>};
const Context = createContext<Value>({locale: 'en', messages: {}});
export function I18nProvider({locale, messages, children}: Value & {children: React.ReactNode}) {
  const value = useMemo(() => ({locale, messages}), [locale, messages]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useT() {
  const {locale, messages} = useContext(Context);
  return useMemo(() => ({locale, t: translator(messages), has: (key: string) => key in messages}), [locale, messages]);
}
// Language names are shown in their own language, as is conventional for a language switcher.
const names: Record<string, string> = {en: 'English', es: 'Español', ru: 'Русский'};
export function LocaleSwitch() {
  const {t, locale} = useT(), router = useRouter();
  return <label className="locale"><span className="sr-only">{t('language')}</span>
    <select value={locale} onChange={event => {
      document.cookie = 'admin_locale=' + event.target.value + '; path=/; max-age=31536000; samesite=lax';
      router.refresh();
    }}>{locales.map(code => <option key={code} value={code}>{names[code]}</option>)}</select></label>;
}
