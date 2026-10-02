import {getTranslations} from 'next-intl/server';
import {AnnouncementStudio} from '../../../components/announcement-studio';
import {SectionGuide} from '../../../components/guide/section-guide';
import {currentUser} from '../../../lib/session';
export default async function SharePage(){const [t,user]=await Promise.all([getTranslations('App'),currentUser()]);return <main className="form-page studio-page"><SectionGuide id="share" userId={user?.id} steps={['fields','size','export']}/><h1>{t('studioTitle')}</h1><p className="intro">{t('studioIntro')}</p><AnnouncementStudio/></main>;}
