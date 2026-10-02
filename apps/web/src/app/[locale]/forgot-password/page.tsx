import {getTranslations as pageTitle} from 'next-intl/server';
import {AuthForm} from '../../../components/account/auth-form';
export async function generateMetadata() {const t = await pageTitle('App'); return {title: t('forgotTitle'), robots: {index: false}};}
export default function Page() {return <main><AuthForm mode="forgot"/></main>;}
