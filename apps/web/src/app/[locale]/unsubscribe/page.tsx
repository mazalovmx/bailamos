import Link from 'next/link';
import type {Metadata} from 'next';
import {getTranslations} from 'next-intl/server';
import {verifyUnsubscribeToken} from '../../../lib/digest/token';
import {UnsubscribeForm} from '../../../components/courses/unsubscribe-form';
import '../../styles/courses.css';
type Props = {params: Promise<{locale: string}>; searchParams: Promise<Record<string, string | string[] | undefined>>};
export async function generateMetadata({params}: Props): Promise<Metadata> {
  const t = await getTranslations({locale: (await params).locale, namespace: 'Courses'});
  // The token is in the URL: keep the page out of indexes and out of Referer headers.
  return {title: t('unsubscribeTitle'), robots: {index: false, follow: false}, referrer: 'no-referrer'};
}
// Opening the link changes nothing (mail scanners follow links); the button on the page sends the POST.
export default async function Unsubscribe({params, searchParams}: Props) {
  const {locale} = await params, raw = (await searchParams).token, token = Array.isArray(raw) ? raw[0] : raw || '';
  const t = await getTranslations('Courses'), valid = !!verifyUnsubscribeToken(token);
  return <main className="courses-page"><p className="eyebrow">{t('digestName')}</p><h1>{t('unsubscribeTitle')}</h1>
    {valid ? <UnsubscribeForm token={token}/> : <div className="unsubscribe-box"><p className="form-error" role="alert">{t('unsubscribeInvalid')}</p>
      <p><Link href={'/' + locale + '/settings'}>{t('unsubscribeSettings')}</Link></p></div>}
  </main>;
}
