'use client';
import {useLocale, useTranslations} from 'next-intl';
import {useRouter} from 'next/navigation';
import {useState} from 'react';
import Link from 'next/link';
import {send, useStatus, type Option} from './shared';
import {swingStyles} from '../../lib/swing';
import '../../app/styles/account.css';
const roles = ['LEADER','FOLLOWER','BOTH'], levels = ['NEWCOMER','BEGINNER','INTERMEDIATE','ADVANCED','PRO'], kinds = ['DANCER','SCHOOL','ORGANIZER'] as const;
export function OnboardingForm({cities, styles, needsConsent, next}: {cities: Option[]; styles: Option[]; needsConsent: boolean; next?: string}) {
  const t = useTranslations('Account'), app = useTranslations('App'), locale = useLocale(), router = useRouter(), s = useStatus();
  const [kind, setKind] = useState<typeof kinds[number]>('DANCER'), dancer = kind === 'DANCER';
  // The swing family comes first; the other three hundred styles stay one click away instead of filling the screen.
  const popular = styles.filter(style => swingStyles.includes(style.id)), other = styles.filter(style => !swingStyles.includes(style.id));
  const box = (o: Option) => <label key={o.id} className="checkbox"><input type="checkbox" name="styleIds" value={o.id}/><span>{o.name}</span></label>;
  return <form className="editor-form" onSubmit={e => {e.preventDefault(); const data = new FormData(e.currentTarget);
    const styleIds = data.getAll('styleIds');
    if (dancer && !styleIds.length) {s.setError('STYLE_REQUIRED'); return;}
    s.run(async () => {
      const made = await send('/api/profile/onboarding', 'POST', {type: kind, cityId: data.get('cityId'), styleIds: dancer ? styleIds : [],
        ...(dancer ? {role: data.get('role'), level: data.get('level')} : {}), consent: data.get('consent') === 'on'});
      // A school goes straight to its own page, where the next step is to add classes.
      router.push(next || (dancer ? '/' + locale + '/profile?welcome=1' : '/' + locale + '/schools/' + made.handle)); router.refresh();
    });}}>
    <fieldset className="choice-group"><legend>{t('onboardingWho')}</legend>
      <div className="choice-list">{kinds.map(id => <label key={id} className="checkbox"><input type="radio" name="kind" value={id} checked={kind === id} onChange={() => setKind(id)}/><span>{t('onboardingKind_' + id)}</span></label>)}</div>
    </fieldset>
    <label>{app('city')}<select name="cityId" required defaultValue=""><option value="">{app('choose')}</option>
      {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    {dancer ? <>
      <fieldset className="choice-group"><legend>{t('onboardingStyles')}</legend>
        <p className="field-note">{t('onboardingStylesHint')}</p>
        <div className="choice-list">{popular.map(box)}</div>
        <details><summary>{t('onboardingAllStyles', {count: other.length})}</summary><div className="choice-list">{other.map(box)}</div></details>
      </fieldset>
      <div className="form-grid">
        <label>{app('role')}<select name="role" required defaultValue=""><option value="">{app('choose')}</option>
          {roles.map(id => <option key={id} value={id}>{app(id)}</option>)}</select></label>
        <label>{app('level')}<select name="level" required defaultValue=""><option value="">{app('choose')}</option>
          {levels.map(id => <option key={id} value={id}>{app(id)}</option>)}</select></label>
      </div>
      <p className="field-note">{t('onboardingPartnerNote')}</p>
    </> : <p className="notice">{t('onboardingSchoolNote')}</p>}
    {needsConsent && <><label className="checkbox"><input name="consent" type="checkbox" required/><span>{t('consent')}</span></label>
      <p className="field-note"><Link href={'/' + locale + '/privacy'}>{t('readPolicy')}</Link></p></>}
    {s.feedback}
    <button className="button" disabled={s.busy}>{s.busy ? app('working') : t('onboardingSubmit')}</button>
  </form>;
}
