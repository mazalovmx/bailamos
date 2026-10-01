import {redirect} from 'next/navigation';
import {LoginForm} from '../../components/login-form';
import {currentStaff} from '../../lib/guard';
export default async function Login() {
  if (await currentStaff()) redirect('/');
  return <LoginForm/>;
}
