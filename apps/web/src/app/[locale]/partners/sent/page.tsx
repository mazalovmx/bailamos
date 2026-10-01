import {getTranslations} from 'next-intl/server';
import {redirect} from 'next/navigation';
import {currentUser} from '../../../../lib/session';
import {myInterests} from '../../../../lib/matching/interest';
import {ContactList, PartnersNav} from '../../../../components/matching/shared';
import '../../../styles/matching.css';
export const dynamic = 'force-dynamic';
export async function generateMetadata() {
  const t = await getTranslations('Matching');
  return {title: t('sentTitle'), robots: {index: false, follow: false}};
}
// Interests the viewer sent that are not mutual yet; each can be withdrawn. The recipients do not know about them.
export default async function Sent({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params, user = await currentUser();
  if (!user?.profile) redirect('/' + locale + '/partners');
  const t = await getTranslations('Matching'), {sent} = await myInterests(user.profile.id);
  return <main className="detail-page partner-page"><h1>{t('sentTitle')}</h1><p className="intro">{t('sentIntro')}</p>
    <PartnersNav locale={locale} current="sent"/>
    {sent.length ? <ContactList locale={locale} contacts={sent} matched={false}/> : <p className="notice">{t('noSent')}</p>}
  </main>;
}
