'use client';
import {useRouter} from 'next/navigation';
import {useTranslations} from 'next-intl';
import {ImageUpload} from '../media/image-upload';
// Avatar and cover upload for the profile owner; the server writes Profile.avatarKey / coverKey on completion.
export function ProfilePhotos() {
  const t = useTranslations('Account'), router = useRouter();
  return <div className="form-grid">
    <div><h3>{t('avatarLabel')}</h3><ImageUpload target="avatar" onUploaded={() => router.refresh()}/></div>
    <div><h3>{t('coverLabel')}</h3><ImageUpload target="cover" onUploaded={() => router.refresh()}/></div>
  </div>;
}
