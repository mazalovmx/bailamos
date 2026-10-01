import {AuthForm} from '../../../components/forms';
export default async function Page({searchParams}:{searchParams:Promise<{token?:string}>}){const {token}=await searchParams;return <main><AuthForm mode="reset" token={token}/></main>;}
