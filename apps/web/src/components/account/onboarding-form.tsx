'use client';
import {useLocale, useTranslations} from 'next-intl';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import {send, useStatus, type Option} from './shared';
import '../../app/styles/account.css';
const roles = ['LEADER','FOLLOWER','BOTH'], levels = ['NEWCOMER','BEGINNER','INTERMEDIATE','ADVANCED','PRO'];
export function OnboardingForm({cities, styles, needsConsent}: {cities: Option[]; styles: Option[]; needsConsent: boolean}) {
  const t = useTranslations('Account'), app = useTranslations('App'), locale = useLocale(), router = useRouter(), s = useStatus();
  return <form className="editor-form" onSubmit={e => {e.preventDefault(); const data = new FormData(e.currentTarget);
    const styleIds = data.getAll('styleIds');
    if (!styleIds.length) {s.setError('STYLE_REQUIRED'); return;}
    s.run(async () => {
      await send('/api/profile/onboarding', 'POST', {cityId: data.get('cityId'), styleIds, role: data.get('role'), level: data.get('level'), consent: data.get('consent') === 'on'});
      router.push('/' + locale + '/profile?welcome=1'); router.refresh();
    });}}>
    <label>{app('city')}<select name="cityId" required defaultValue=""><option value="">{app('choose')}</option>
      {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <fieldset className="choice-group"><legend>{t('onboardingStyles')}</legend>
      <p className="field-note">{t('onboardingStylesHint')}</p>
      <div className="choice-list">{styles.map(o => <label key={o.id} className="checkbox"><input type="checkbox" name="styleIds" value={o.id}/><span>{o.name}</span></label>)}</div>
    </fieldset>
    <div className="form-grid">
      <label>{app('role')}<select name="role" required defaultValue=""><option value="">{app('choose')}</option>
        {roles.map(id => <option key={id} value={id}>{app(id)}</option>)}</select></label>
      <label>{app('level')}<select name="level" required defaultValue=""><option value="">{app('choose')}</option>
        {levels.map(id => <option key={id} value={id}>{app(id)}</option>)}</select></label>
    </div>
    <p className="field-note">{t('onboardingPartnerNote')}</p>
    {needsConsent && <><label className="checkbox"><input name="consent" type="checkbox" required/><span>{t('consent')}</span></label>
      <p className="field-note"><Link href={'/' + locale + '/privacy'}>{t('readPolicy')}</Link></p></>}
    {s.feedback}
    <button className="button" disabled={s.busy}>{s.busy ? app('working') : t('onboardingSubmit')}</button>
  </form>;
}
