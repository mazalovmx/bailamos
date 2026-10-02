import {getTranslations as pageTitle} from 'next-intl/server';
import {AuthForm} from '../../../components/account/auth-form';
import {googleEnabled} from '../../../lib/auth';
export async function generateMetadata() {const t = await pageTitle('App'); return {title: t('signUp')};}
export default function Page() {return <main><AuthForm mode="register" google={googleEnabled()}/></main>;}
