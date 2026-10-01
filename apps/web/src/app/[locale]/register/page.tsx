import {AuthForm} from '../../../components/account/auth-form';
import {googleEnabled} from '../../../lib/auth';
export default function Page() {return <main><AuthForm mode="register" google={googleEnabled()}/></main>;}
