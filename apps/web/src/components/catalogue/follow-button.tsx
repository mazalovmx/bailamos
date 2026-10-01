'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useLocale, useTranslations} from 'next-intl';
import '../../app/styles/catalogue.css';
export type FollowTarget = {cityId?: string; styleId?: string; profileId?: string};
// Subscribe to a city, a style or a profile. Exactly one id must be set in `target`.
export function FollowButton({target, initialFollowing, signedIn}: {target: FollowTarget; initialFollowing: boolean; signedIn: boolean}) {
  const t = useTranslations('Catalogue'), locale = useLocale(), router = useRouter();
  const [following, setFollowing] = useState(initialFollowing), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!signedIn) return <div className="follow"><Link className="button secondary" href={'/' + locale + '/login'}>{t('signInToFollow')}</Link></div>;
  async function toggle() {
    setBusy(true); setError('');
    try {
      const body = target.cityId ? {cityId: target.cityId} : target.styleId ? {styleId: target.styleId} : {profileId: target.profileId};
      const response = await fetch('/api/follows', {method: following ? 'DELETE' : 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'GENERIC');
      setFollowing(!!data.following);
      router.refresh();
    } catch (failure) {setError(failure instanceof Error ? failure.message : 'GENERIC');} finally {setBusy(false);}
  }
  return <div className="follow">
    <button type="button" className={following ? 'button' : 'button secondary'} aria-pressed={following} disabled={busy} onClick={toggle}>
      <span aria-hidden="true">{following ? '✓' : '+'}</span>{t(following ? 'following' : 'follow')}</button>
    {error && <p role="alert" className="form-error">{t.has('error_' + error) ? t('error_' + error) : t('error_GENERIC')}</p>}
  </div>;
}
