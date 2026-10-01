import {createTranslator} from 'next-intl';
import en from '../../../messages/features/EventsX/en.json';
import es from '../../../messages/features/EventsX/es.json';
import ru from '../../../messages/features/EventsX/ru.json';
import type {MailLocale} from '../mail';
const catalogues={en,es,ru};
// Mail is written outside a request, in the recipient's language, from the same EventsX messages as the interface.
export function mailText(locale:MailLocale) {
  return createTranslator({locale,messages:{EventsX:catalogues[locale]},namespace:'EventsX'});
}
export function mailDate(date:Date,locale:MailLocale,timezone:string) {
  return new Intl.DateTimeFormat(locale,{dateStyle:'full',timeStyle:'short',timeZone:timezone}).format(date)+' ('+timezone+')';
}
