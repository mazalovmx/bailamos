import {getTranslations} from 'next-intl/server';
import {redirect} from 'next/navigation';
import {currentUser} from '../../../lib/session';
import {catalogue} from '../../../lib/catalogue';
import {OnboardingForm} from '../../../components/account/onboarding-form';
export async function generateMetadata() {
  const t = await getTranslations('Account');
  return {title: t('onboardingTitle'), robots: {index: false}};
}
export default async function Onboarding({params, searchParams}: {params: Promise<{locale: string}>; searchParams: Promise<{next?: string}>}) {
  const {locale} = await params, {next} = await searchParams, user = await currentUser();
  // Only a path inside this locale is accepted as a return target.
  const target = typeof next === 'string' && next.startsWith('/' + locale + '/') && !next.includes('//') && !next.includes('\\') && next.length < 300 ? next : undefined;
  if (!user) redirect('/' + locale + '/login');
  if (user.profile) redirect(target || '/' + locale + '/profile');
  const t = await getTranslations('Account'), {cities, styles} = await catalogue();
  return <main className="form-page"><p className="eyebrow">{t('onboardingStep')}</p><h1>{t('onboardingTitle')}</h1>
    <p className="intro">{t('onboardingText')}</p>
    {!user.emailVerified && <p className="notice" role="status">{t('verifyFirst')}</p>}
    <OnboardingForm cities={cities.map(c => ({id: c.id, name: c.name}))} styles={styles} needsConsent={!(user as {ageConfirmed?: boolean | null}).ageConfirmed} next={target}/>
  </main>;
}
