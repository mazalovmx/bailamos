import {cache} from 'react';
import {headers} from 'next/headers';
import {auth} from './auth';
import {db} from '@dance/db';
import {touchActivity} from './matching/interest';
export const currentUser = cache(async () => {
  const session = await auth.api.getSession({headers: await headers()});
  if (!session) return null;
  const account = await db.user.findUnique({where: {id: session.user.id},
    select: {role: true, bannedAt: true, profile: {include: {skills: true}}}});
  if (!account) return null;
  if (account.bannedAt) {
    // A ban signs the user out everywhere; the next sign-in attempt is refused with the BANNED message.
    await db.session.deleteMany({where: {userId: session.user.id}});
    return null;
  }
  // Activity freshness feeds partner-search ranking; written at most once an hour, never awaited.
  if (account.profile) void touchActivity(account.profile.id).catch(() => undefined);
  return {...session.user, role: account.role, profile: account.profile};
});
