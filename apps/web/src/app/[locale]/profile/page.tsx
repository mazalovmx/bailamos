import {getTranslations} from 'next-intl/server';
import {redirect} from 'next/navigation';
import Link from 'next/link';
import {currentUser} from '../../../lib/session';
import {catalogue} from '../../../lib/catalogue';
import {mediaUrl} from '../../../lib/account/media';
import {ProfilePhotos} from '../../../components/account/profile-photos';
import {ProfileForm, SkillsEditor} from '../../../components/account/profile-form';
export async function generateMetadata() {
  const t = await getTranslations('App');
  return {title: t('profile'), robots: {index: false}};
}
export default async function Profile({params, searchParams}: {params: Promise<{locale: string}>; searchParams: Promise<{welcome?: string}>}) {
  const {locale} = await params, {welcome} = await searchParams, user = await currentUser();
  if (!user) redirect('/' + locale + '/login');
  const p = user.profile;
  if (!p) redirect('/' + locale + '/onboarding');
  const app = await getTranslations('App'), t = await getTranslations('Account'), {cities, styles} = await catalogue();
  return <main className="form-page"><h1>{app('profileTitle')}</h1><p className="intro">{app('profileText')}</p>
    {welcome && <p className="notice" role="status">{t('welcome')}</p>}
    {p.hiddenAt && <p className="form-error" role="status">{t('profileHidden')}</p>}
    <div className="profile-actions"><a className="button secondary" href={'/' + locale + '/@' + p.handle}>{t('viewPublic')}</a>
      <Link className="button secondary" href={'/' + locale + '/settings'}>{t('settingsTitle')}</Link></div>
    <section className="account-section" aria-labelledby="photos-title"><h2 id="photos-title">{t('photosTitle')}</h2>
      {p.coverKey && <img className="profile-cover" src={mediaUrl(p.coverKey)} alt={t('coverAlt', {name: p.name})}/>}
      {p.avatarKey && <img className="profile-photo" src={mediaUrl(p.avatarKey)} alt={t('avatarAlt', {name: p.name})}/>}
      <ProfilePhotos/>
    </section>
    <section className="account-section" aria-labelledby="about-title"><h2 id="about-title">{t('aboutTitle')}</h2>
      <ProfileForm cities={cities.map(c => ({id: c.id, name: c.name}))} initial={{name: p.name, handle: p.handle, bio: p.bio || '',
        cityId: p.cityId || '', district: p.district || '', instagram: p.instagram || '', type: p.type}}/></section>
    <section className="account-section" aria-labelledby="skills-title"><h2 id="skills-title">{t('skillsTitle')}</h2><p>{t('skillsText')}</p>
      <SkillsEditor styles={styles} initial={p.skills.map(s => ({styleId: s.styleId, role: s.role, level: s.level, lookingFor: s.lookingFor}))}/></section>
  </main>;
}
