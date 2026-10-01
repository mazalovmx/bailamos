import {getTranslations} from 'next-intl/server';
import {redirect} from 'next/navigation';
import {currentUser} from '../../../../lib/session';
import {myInterests} from '../../../../lib/matching/interest';
import {ContactList, PartnersNav} from '../../../../components/matching/shared';
import '../../../styles/matching.css';
export const dynamic = 'force-dynamic';
export async function generateMetadata() {
  const t = await getTranslations('Matching');
  return {title: t('matchesTitle'), robots: {index: false, follow: false}};
}
// Mutual interest only. Visitors without a session or a profile go to the explanatory search page.
export default async function Matches({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params, user = await currentUser();
  if (!user?.profile) redirect('/' + locale + '/partners');
  const t = await getTranslations('Matching'), {matches} = await myInterests(user.profile.id);
  return <main className="detail-page partner-page"><h1>{t('matchesTitle')}</h1><p className="intro">{t('matchesIntro')}</p>
    <PartnersNav locale={locale} current="matches"/>
    {matches.length ? <ContactList locale={locale} contacts={matches} matched/> : <p className="notice">{t('noMatches')}</p>}
    <p className="field-note">{t('safetyNote')}</p>
  </main>;
}
