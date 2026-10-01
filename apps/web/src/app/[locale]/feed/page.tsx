import type {Metadata} from 'next';
import {getTranslations} from 'next-intl/server';
import Link from 'next/link';
import {FeedList} from '../../../components/feed/feed-list';
import {currentCitySlug} from '../../../lib/catalogue/current-city';
import {feedPage} from '../../../lib/feed/query';
import {currentUser} from '../../../lib/session';
import '../../styles/blog.css';
export async function generateMetadata({params}: {params: Promise<{locale: string}>}): Promise<Metadata> {
  const t = await getTranslations({locale: (await params).locale, namespace: 'Feed'});
  return {title: t('title'), robots: {index: false, follow: true}};
}
export default async function Feed({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  const [t, user, citySlug] = await Promise.all([getTranslations('Feed'), currentUser(), currentCitySlug()]);
  const page = await feedPage({userId: user?.id, profileId: user?.profile?.id, citySlug});
  return <main className="detail-page blog-page">
    <h1>{t('title')}</h1>
    <p className="intro">{page.mode === 'personal' ? t('introPersonal') : page.city ? t('introCity', {city: page.city.name}) : t('introGeneral')}</p>
    {page.mode === 'fallback' && <aside className="notice feed-prompt" aria-labelledby="feed-prompt-title">
      <h2 id="feed-prompt-title">{t('promptTitle')}</h2>
      <p>{t(user ? 'promptText' : 'promptTextSignedOut')}</p>
      <p className="post-links">
        <Link href={'/' + locale + '/cities'}>{t('browseCities')}</Link>
        <Link href={'/' + locale + '/styles'}>{t('browseStyles')}</Link>
        {!user && <Link href={'/' + locale + '/login'}>{t('signIn')}</Link>}
      </p>
    </aside>}
    <FeedList initial={page.items} initialCursor={page.nextCursor}/>
  </main>;
}
