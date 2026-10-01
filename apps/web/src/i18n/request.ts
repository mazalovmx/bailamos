import {getRequestConfig} from 'next-intl/server';
import {hasLocale} from 'next-intl';
import {routing} from './routing';
// Each feature owns messages/features/<Namespace>/<locale>.json and reads it as useTranslations('<Namespace>').
export const featureNamespaces = ['Account','Catalogue','Geo','Calendar','Media','EventsX','Moderation','Blog','Notifications','Matching','Chat','Courses','Feed'] as const;
export default getRequestConfig(async ({requestLocale}) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const features = await Promise.all(featureNamespaces.map(async name =>
    [name, (await import('../../messages/features/' + name + '/' + locale + '.json')).default] as const));
  return {locale, messages: {
    ...(await import('../../messages/' + locale + '.json')).default,
    App: (await import('../../messages/app/' + locale + '.json')).default,
    ...Object.fromEntries(features)
  }};
});
