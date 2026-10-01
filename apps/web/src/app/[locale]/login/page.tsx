import {redirect} from 'next/navigation';
import {AuthForm} from '../../../components/account/auth-form';
import {googleEnabled} from '../../../lib/auth';
import {currentUser} from '../../../lib/session';
export default async function Page({params, searchParams}: {params: Promise<{locale: string}>; searchParams: Promise<{error?: string}>}) {
  const {locale} = await params, {error} = await searchParams;
  if (!error && await currentUser()) redirect('/' + locale + '/profile');
  // Magic-link and Google failures come back as ?error=<code>; only a short code is passed on, never free text.
  const code = typeof error === 'string' && /^[A-Za-z0-9_]{1,60}$/.test(error) ? error.toUpperCase() : undefined;
  return <main><AuthForm mode="login" google={googleEnabled()} initialError={code}/></main>;
}
