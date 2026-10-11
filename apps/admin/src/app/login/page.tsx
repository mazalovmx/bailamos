import {redirect} from 'next/navigation';
import {LoginForm} from '../../components/login-form';
import {currentStaff} from '../../lib/guard';
import {adminGoogleCredentials} from '../../lib/auth-policy';
export default async function Login({searchParams}: {searchParams: Promise<{error?: string}>}) {
  if (await currentStaff()) redirect('/');
  const {error} = await searchParams;
  return <LoginForm googleEnabled={!!adminGoogleCredentials()} emailEnabled={process.env.EMAIL_AUTH_ENABLED !== 'false'} oauthError={!!error}/>;
}
