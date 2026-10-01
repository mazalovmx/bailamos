import {AuthForm} from '../../../components/account/auth-form';
export default async function Page({searchParams}: {searchParams: Promise<{token?: string; error?: string}>}) {
  const {token, error} = await searchParams;
  return <main><AuthForm mode="reset" token={token} initialError={error || !token ? 'INVALID_TOKEN' : undefined}/></main>;
}
