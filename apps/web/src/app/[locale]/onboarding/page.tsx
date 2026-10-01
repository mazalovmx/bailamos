import {getTranslations} from 'next-intl/server';
import {redirect} from 'next/navigation';
import {currentUser} from '../../../lib/session';
import {catalogue} from '../../../lib/catalogue';
import {OnboardingForm} from '../../../components/account/onboarding-form';
export async function generateMetadata() {
  const t = await getTranslations('Account');
  return {title: t('onboardingTitle'), robots: {index: false}};
}
export default async function Onboarding({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params, user = await currentUser();
  if (!user) redirect('/' + locale + '/login');
  if (user.profile) redirect('/' + locale + '/profile');
  const t = await getTranslations('Account'), {cities, styles} = await catalogue();
  return <main className="form-page"><p className="eyebrow">{t('onboardingStep')}</p><h1>{t('onboardingTitle')}</h1>
    <p className="intro">{t('onboardingText')}</p>
    {!user.emailVerified && <p className="notice" role="status">{t('verifyFirst')}</p>}
    <OnboardingForm cities={cities.map(c => ({id: c.id, name: c.name}))} styles={styles} needsConsent={!(user as {ageConfirmed?: boolean | null}).ageConfirmed}/>
  </main>;
}
