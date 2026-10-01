import {getTranslations} from 'next-intl/server';
import {siteUrl} from '../../../lib/mail';
import {POLICY_VERSION} from '../../../lib/account/consent';
import '../../styles/account.css';
const sections = ['collect', 'use', 'public', 'location', 'partner', 'share', 'retention', 'rights', 'age', 'cookies', 'changes', 'contact'] as const;
export async function generateMetadata({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params, t = await getTranslations({locale, namespace: 'Account'}), origin = siteUrl();
  return {title: t('privacyTitle'), description: t('privacyIntro'), alternates: {canonical: origin + '/' + locale + '/privacy',
    languages: {en: origin + '/en/privacy', es: origin + '/es/privacy', ru: origin + '/ru/privacy'}}};
}
export default async function Privacy() {
  const t = await getTranslations('Account');
  const contact = process.env.PRIVACY_CONTACT_EMAIL || 'privacy@dance.local';
  return <main className="detail-page policy"><h1>{t('privacyTitle')}</h1>
    <p className="intro">{t('privacyIntro')}</p><p className="field-note">{t('policyVersion', {version: POLICY_VERSION})}</p>
    {sections.map(id => <section key={id} aria-labelledby={'policy-' + id}><h2 id={'policy-' + id}>{t('privacy_' + id + '_title')}</h2>
      {t('privacy_' + id + '_text', {email: contact}).split('\n').map((line, i) => <p key={i}>{line}</p>)}</section>)}
  </main>;
}
