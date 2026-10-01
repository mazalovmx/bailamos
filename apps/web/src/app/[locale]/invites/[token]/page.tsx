import {getTranslations} from 'next-intl/server';
import Link from 'next/link';
import {currentUser} from '../../../../lib/session';
import {findInvite,inviteState,inviteMatches} from '../../../../lib/events/invites';
import {InviteAnswer} from '../../../../components/events/manage';
import '../../../styles/events.css';
// The token is a secret: keep the page out of indexes and do not send it on as a referrer.
export const metadata={robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default async function InvitePage({params}:{params:Promise<{locale:string;token:string}>}) {
  const {locale,token}=await params,x=await getTranslations('EventsX'),t=await getTranslations('App');
  const user=await currentUser();
  const page=(body:React.ReactNode)=><main className="form-page narrow"><p className="eyebrow">{x('inviteEyebrow')}</p><h1>{x('inviteTitle')}</h1>{body}</main>;
  // Nothing about the invitation is shown before sign-in: the link alone proves nothing.
  if(!user) return page(<><p className="intro">{x('inviteSignIn')}</p><Link className="button" href={'/'+locale+'/login?next='+encodeURIComponent('/'+locale+'/invites/'+token)}>{t('signIn')}</Link>
    <p className="field-note">{x('inviteSignInHint')}</p></>);
  const invite=await findInvite(token);
  if(!invite||inviteState(invite)!=='PENDING') return page(<p className="notice" role="status">{x('error_INVITE_INVALID')}</p>);
  if(!inviteMatches(invite,user)) return page(<p className="notice" role="status">{x(user.emailVerified?'error_INVITE_MISMATCH':'inviteVerifyEmail')}</p>);
  const date=new Intl.DateTimeFormat(locale,{dateStyle:'full',timeStyle:'short',timeZone:invite.event.timezone}).format(invite.event.startsAt);
  return page(<>
    <p className="intro">{x('inviteText',{title:invite.event.title})}</p>
    <p>{date} · {invite.event.city.name} <small>({invite.event.timezone})</small></p>
    <p className="field-note">{x('inviteRights')}</p>
    {user.profile?<InviteAnswer token={token} slug={invite.event.slug}/>:<><p className="notice">{t('profileRequired')}</p><Link className="button" href={'/'+locale+'/profile'}>{t('editProfile')}</Link></>}
    <p className="field-note">{x('inviteExpires',{date:new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(invite.expiresAt)})}</p>
  </>);
}
