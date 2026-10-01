import {getTranslations} from 'next-intl/server';
import {AnnouncementStudio} from '../../../components/announcement-studio';
export default async function SharePage(){const t=await getTranslations('App');return <main className="form-page studio-page"><h1>{t('studioTitle')}</h1><p className="intro">{t('studioIntro')}</p><AnnouncementStudio/></main>;}
